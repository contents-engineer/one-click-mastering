/**
 * Offline (whole-buffer) STFT de-harsh — must stay equivalent to
 * `public/worklets/de-harsh-processor.js` (live == download). fftSize 1024,
 * hop 256 (75% overlap), Hann window, overlap-add normalized by 1.5.
 * Algorithm origin: entrepeneur4lyf/Web-Audio-Mastering (ISC).
 */
import type { DeHarshPreset } from './types'

const FFT_SIZE = 1024
const HOP = 256
const NUM_BINS = FFT_SIZE / 2
const RESONANCE_LOW_HZ = 1000
const RESONANCE_HIGH_HZ = 10000

const dbToLinear = (db: number) => Math.pow(10, db / 20)
const linearToDb = (lin: number) => (lin > 0 ? 20 * Math.log10(lin) : -Infinity)

interface Band {
  freqLow: number
  freqHigh: number
  attackMs: number
  releaseMs: number
  thresholdDb: number
  ratio: number
  kneeDb: number
  enabled: boolean
}

const DEFAULT_BANDS: Band[] = [
  { freqLow: 0, freqHigh: 80, attackMs: 30, releaseMs: 200, thresholdDb: -12, ratio: 2, kneeDb: 10, enabled: false },
  { freqLow: 80, freqHigh: 250, attackMs: 20, releaseMs: 150, thresholdDb: -15, ratio: 2.5, kneeDb: 8, enabled: false },
  { freqLow: 250, freqHigh: 1000, attackMs: 10, releaseMs: 100, thresholdDb: -18, ratio: 3, kneeDb: 6, enabled: false },
  { freqLow: 1000, freqHigh: 3000, attackMs: 8, releaseMs: 80, thresholdDb: -20, ratio: 3.5, kneeDb: 6, enabled: false },
  { freqLow: 3000, freqHigh: 6000, attackMs: 2, releaseMs: 40, thresholdDb: -24, ratio: 3, kneeDb: 4, enabled: true },
  { freqLow: 6000, freqHigh: 12000, attackMs: 2, releaseMs: 30, thresholdDb: -26, ratio: 3.5, kneeDb: 3, enabled: true },
  { freqLow: 12000, freqHigh: 20000, attackMs: 5, releaseMs: 50, thresholdDb: -22, ratio: 2, kneeDb: 6, enabled: false },
]

function presetBands(preset: DeHarshPreset): Band[] {
  if (preset === 'aggressive') {
    return DEFAULT_BANDS.map((b) => ({ ...b, thresholdDb: b.thresholdDb - 6, ratio: b.ratio + 2 }))
  }
  return DEFAULT_BANDS.map((b) => ({ ...b, thresholdDb: b.thresholdDb + 6, ratio: Math.max(2, b.ratio - 1) }))
}
function presetParams(preset: DeHarshPreset): { sensitivity: number; maxCut: number } {
  return preset === 'aggressive' ? { sensitivity: 0.8, maxCut: -18 } : { sensitivity: 0.3, maxCut: -6 }
}

/** In-place radix-2 FFT (real input via im=0); `inverse` scales by 1/n. */
function makeFFT(n: number) {
  const cos = new Float32Array(n / 2)
  const sin = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n)
    sin[i] = Math.sin((-2 * Math.PI * i) / n)
  }
  const rev = new Uint32Array(n)
  let bits = 0
  while (1 << bits < n) bits++
  for (let i = 0; i < n; i++) {
    let x = i
    let r = 0
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1)
      x >>= 1
    }
    rev[i] = r
  }
  return function transform(re: Float32Array, im: Float32Array, inverse: boolean) {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const ci = k * step
          const wr = cos[ci]
          const wi = inverse ? -sin[ci] : sin[ci]
          const a = i + k
          const b = i + k + half
          const tr = wr * re[b] - wi * im[b]
          const ti = wr * im[b] + wi * re[b]
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n
        im[i] /= n
      }
    }
  }
}

class EnvelopeFollower {
  attackCoef: number
  releaseCoef: number
  env = 0
  constructor(sampleRate: number, attackMs: number, releaseMs: number) {
    this.attackCoef = Math.exp(-1 / ((sampleRate * attackMs) / 1000))
    this.releaseCoef = Math.exp(-1 / ((sampleRate * releaseMs) / 1000))
  }
  process(x: number): number {
    const abs = Math.abs(x)
    const c = abs > this.env ? this.attackCoef : this.releaseCoef
    this.env = c * this.env + (1 - c) * abs
    return this.env
  }
}

function gainComputerDb(inputDb: number, thr: number, ratio: number, knee: number): number {
  const ks = thr - knee / 2
  const ke = thr + knee / 2
  if (inputDb <= ks) return 0
  if (inputDb >= ke) {
    const ex = inputDb - thr
    return ex / ratio - ex
  }
  const kp = (inputDb - ks) / knee
  const full = (inputDb - thr) * (1 - 1 / ratio)
  return -full * kp * kp
}

/** De-harsh one channel via STFT overlap-add. Returns a new Float32Array. */
function deharshChannel(input: Float32Array, sampleRate: number, bands: Band[], params: { sensitivity: number; maxCut: number }): Float32Array {
  const fft = makeFFT(FFT_SIZE)
  const window = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
  const envs = bands.map((b) => new EnvelopeFollower(sampleRate, b.attackMs, b.releaseMs))
  const avgSpec = new Float32Array(NUM_BINS)
  let specInit = false
  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)
  const mag = new Float32Array(NUM_BINS)
  const out = new Float32Array(input.length + FFT_SIZE)
  const frame = new Float32Array(FFT_SIZE)

  const bandForFreq = (freq: number): number => {
    for (let i = 0; i < bands.length; i++) if (freq >= bands[i].freqLow && freq < bands[i].freqHigh) return i
    return bands.length - 1
  }

  for (let pos = 0; pos < input.length; pos += HOP) {
    const n = Math.min(FFT_SIZE, input.length - pos)
    frame.fill(0)
    frame.set(input.subarray(pos, pos + n))
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = frame[i] * window[i]
      im[i] = 0
    }
    fft(re, im, false)
    for (let b = 0; b < NUM_BINS; b++) mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b])

    const bandE = new Float32Array(bands.length)
    const bandN = new Float32Array(bands.length)
    for (let b = 0; b < NUM_BINS; b++) {
      const f = (b * sampleRate) / FFT_SIZE
      const bi = bandForFreq(f)
      bandE[bi] += mag[b] * mag[b]
      bandN[bi]++
    }
    for (let i = 0; i < bands.length; i++) if (bandN[i] > 0) bandE[i] = Math.sqrt(bandE[i] / bandN[i])
    const bandGain = new Float32Array(bands.length)
    for (let i = 0; i < bands.length; i++) {
      const env = envs[i].process(bandE[i])
      bandGain[i] = bands[i].enabled === false ? 0 : gainComputerDb(linearToDb(env), bands[i].thresholdDb, bands[i].ratio, bands[i].kneeDb)
    }

    const resonance = new Float32Array(NUM_BINS)
    if (!specInit) {
      avgSpec.set(mag)
      specInit = true
    } else {
      for (let b = 0; b < NUM_BINS; b++) {
        const m = mag[b]
        avgSpec[b] = 0.3 * m + 0.7 * avgSpec[b]
        const avg = avgSpec[b]
        if (avg > 1e-10 && m > avg * 1.5) resonance[b] = Math.min(1, (m / avg - 1.5) / 2)
      }
    }

    const { sensitivity, maxCut } = params
    for (let b = 0; b < NUM_BINS; b++) {
      const f = (b * sampleRate) / FFT_SIZE
      let gDb = bandGain[bandForFreq(f)]
      if (resonance[b] > 0 && f >= RESONANCE_LOW_HZ && f <= RESONANCE_HIGH_HZ) gDb += maxCut * resonance[b] * sensitivity
      if (f >= 5000 && f <= 12000) gDb += gDb * 0.3
      const g = dbToLinear(gDb)
      re[b] *= g
      im[b] *= g
      if (b > 0) {
        const m = FFT_SIZE - b
        re[m] = re[b]
        im[m] = -im[b]
      }
    }
    fft(re, im, true)
    for (let i = 0; i < FFT_SIZE; i++) out[pos + i] += (re[i] * window[i]) / 1.5
  }
  return out.subarray(0, input.length)
}

/** Apply offline de-harsh to a rendered AudioBuffer in place (per channel). */
export function applyDeHarsh(buffer: AudioBuffer, preset: DeHarshPreset): AudioBuffer {
  const bands = presetBands(preset)
  const params = presetParams(preset)
  const channels = Math.min(2, buffer.numberOfChannels)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    const processed = deharshChannel(data, buffer.sampleRate, bands, params)
    data.set(processed)
  }
  return buffer
}
