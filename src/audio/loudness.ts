/**
 * Loudness analysis — integrated LUFS (ITU-R BS.1770 K-weighting + gating),
 * sample peak, true peak (4× oversampled), and transient density.
 * Ported verbatim from the original Manex `Oi`/`cm`/`fm`/`um`/`dm`/`am`.
 */

import { OS_TAPS, OS_FACTOR, TRUE_PEAK_FIR } from './limiterCore'
import type { LoudnessAnalysis } from './types'

/** LUFS measurement render sample rate (BS.1770). */
const MEASURE_SR = 48000
/** Absolute gate (LUFS) and relative gate (LU). */
const ABS_GATE = -70
const REL_GATE = -10

// K-weighting biquads (BS.1770): stage 1 high-shelf, stage 2 high-pass.
const K_SHELF = {
  b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
  a: [1, -1.69065929318241, 0.73248077421585],
}
const K_HPF = {
  b: [1, -2, 1],
  a: [1, -1.99004745483398, 0.99007225036621],
}

/** Block mean-square → loudness in LK (LUFS for a single block). */
function lk(meanSquare: number): number {
  return meanSquare <= 0 ? -Infinity : -0.691 + 10 * Math.log10(meanSquare)
}

/** Render the buffer to 48 kHz through the K-weighting filter chain. */
async function renderKWeighted(buffer: AudioBuffer): Promise<AudioBuffer> {
  const channels = Math.min(2, buffer.numberOfChannels)
  const length = Math.ceil(buffer.duration * MEASURE_SR)
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate: MEASURE_SR })
  const src = ctx.createBufferSource()
  src.buffer = buffer
  if (channels === 1) {
    const shelf = ctx.createIIRFilter(K_SHELF.b, K_SHELF.a)
    const hpf = ctx.createIIRFilter(K_HPF.b, K_HPF.a)
    src.connect(shelf)
    shelf.connect(hpf)
    hpf.connect(ctx.destination)
  } else {
    const splitter = ctx.createChannelSplitter(channels)
    const merger = ctx.createChannelMerger(channels)
    src.connect(splitter)
    for (let c = 0; c < channels; c++) {
      const shelf = ctx.createIIRFilter(K_SHELF.b, K_SHELF.a)
      const hpf = ctx.createIIRFilter(K_HPF.b, K_HPF.a)
      splitter.connect(shelf, c, 0)
      shelf.connect(hpf)
      hpf.connect(merger, 0, c)
    }
    merger.connect(ctx.destination)
  }
  src.start(0)
  return ctx.startRendering()
}

/** Integrated LUFS with absolute (−70) + relative (−10) gating, on a K-weighted buffer. */
function integratedLufs(kBuffer: AudioBuffer): number {
  const sr = kBuffer.sampleRate
  const block = Math.floor(0.4 * sr) // 400 ms
  const hop = Math.floor(0.1 * sr) // 100 ms (75% overlap)
  if (kBuffer.length < block) return -Infinity
  const numCh = kBuffer.numberOfChannels
  const weights = [1, 1]
  const data: Float32Array[] = []
  for (let c = 0; c < numCh; c++) data.push(kBuffer.getChannelData(c))

  const blocks: number[] = []
  const count = Math.floor((kBuffer.length - block) / hop) + 1
  for (let n = 0; n < count; n++) {
    const start = n * hop
    let ms = 0
    for (let c = 0; c < numCh; c++) {
      const ch = data[c]
      let sum = 0
      for (let i = start; i < start + block; i++) sum += ch[i] * ch[i]
      ms += weights[c] * (sum / block)
    }
    blocks.push(ms)
  }
  if (blocks.length === 0) return -Infinity

  const absKept = blocks.filter((ms) => lk(ms) >= ABS_GATE)
  if (absKept.length === 0) return -Infinity
  const absMean = absKept.reduce((a, b) => a + b, 0) / absKept.length
  const relThresh = lk(absMean) + REL_GATE
  const relKept = absKept.filter((ms) => lk(ms) >= relThresh)
  if (relKept.length === 0) return lk(absMean)
  const relMean = relKept.reduce((a, b) => a + b, 0) / relKept.length
  return lk(relMean)
}

/** Sample peak in dBFS across all channels. */
function samplePeakDb(buffer: AudioBuffer): number {
  let peak = 0
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c)
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i])
      if (a > peak) peak = a
    }
  }
  return peak === 0 ? -Infinity : 20 * Math.log10(peak)
}

/** True peak in dBTP via 4× oversampling polyphase FIR (all channels). */
function truePeakDb(buffer: AudioBuffer): number {
  let peak = 0
  const hist = new Float32Array(OS_TAPS)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c)
    hist.fill(0)
    for (let i = 0; i < ch.length; i++) {
      for (let t = 0; t < OS_TAPS - 1; t++) hist[t] = hist[t + 1]
      hist[OS_TAPS - 1] = ch[i]
      for (let p = 0; p < OS_FACTOR; p++) {
        const base = p * OS_TAPS
        let acc = 0
        for (let t = 0; t < OS_TAPS; t++) acc += TRUE_PEAK_FIR[base + t] * hist[t]
        const a = acc < 0 ? -acc : acc
        if (a > peak) peak = a
      }
    }
  }
  return peak === 0 ? -Infinity : 20 * Math.log10(peak)
}

/** Transient density [0,1] — dual envelope follower transient counter. */
function transientDensity(buffer: AudioBuffer): number {
  const sr = buffer.sampleRate
  const channels = Math.min(2, buffer.numberOfChannels)
  const coef = (ms: number) => Math.exp(-1 / ((ms / 1000) * sr))
  const fastAtk = coef(1)
  const fastRel = coef(20)
  const slowAtk = coef(50)
  const slowRel = coef(200)
  const minGap = Math.floor(0.03 * sr) // 30 ms min spacing
  const THRESH = 0.5
  let transients = 0
  const dur = buffer.duration || 1
  for (let c = 0; c < channels; c++) {
    const ch = buffer.getChannelData(c)
    let fast = 0
    let slow = 0
    let gap = minGap
    let armed = true
    for (let i = 0; i < ch.length; i++) {
      const x = Math.abs(ch[i])
      fast = x > fast ? fastAtk * fast + (1 - fastAtk) * x : fastRel * fast + (1 - fastRel) * x
      slow = x > slow ? slowAtk * slow + (1 - slowAtk) * x : slowRel * slow + (1 - slowRel) * x
      const ratio = slow > 1e-6 ? (fast - slow) / slow : 0
      gap++
      if (armed && ratio > THRESH && gap >= minGap) {
        transients++
        gap = 0
        armed = false
      } else if (ratio < THRESH * 0.5) {
        armed = true
      }
    }
  }
  const perSec = transients / (channels * dur)
  return Math.max(0, Math.min(1, perSec / 6))
}

/** Full loudness analysis (mirrors `Oi`). */
export async function analyzeLoudness(buffer: AudioBuffer): Promise<LoudnessAnalysis> {
  const [kBuffer] = await Promise.all([renderKWeighted(buffer)])
  const peakDb = samplePeakDb(buffer)
  const truePeak = truePeakDb(buffer)
  const transient = transientDensity(buffer)
  const lufsI = integratedLufs(kBuffer)
  const crestDb = isFinite(truePeak) && isFinite(lufsI) ? truePeak - lufsI : 0
  return { lufsI, peakDb, truePeakDb: truePeak, crestDb, transientDensity: transient }
}

/**
 * Integrated LUFS only (BS.1770, 48 kHz K-weighting + gating) — same measurement
 * as `analyzeLoudness` but without the peak/transient work. Used by the offline
 * render for closed-loop loudness normalization to the target.
 */
export async function integratedLufsOf(buffer: AudioBuffer): Promise<number> {
  return integratedLufs(await renderKWeighted(buffer))
}

/** Block mean-square → LUFS, exported for the realtime meter. */
export { lk as blockLufs }
