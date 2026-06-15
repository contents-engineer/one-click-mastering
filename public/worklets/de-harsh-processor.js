/**
 * De-harsh AudioWorkletProcessor — 라이브 미리듣기용 실시간 FFT de-harsh.
 *
 * ⚠️ 자체 포함: 워크렛은 격리 스코프라 fft.js/모듈 import 불가 → 라딕스-2 FFT를
 *    직접 인라인. 알고리즘(밴드/공명/AI대역)은 src/lib/de-harsh.ts와 동일하게
 *    유지해야 함(라이브==다운로드 정합). 한쪽 고치면 다른 쪽도.
 *
 *    원 알고리즘 출처: entrepeneur4lyf/Web-Audio-Mastering (ISC) dynamic-processor.js.
 *
 * 실시간 STFT 오버랩-애드: fftSize=1024, hop=256(75% overlap), Hann 윈도우.
 * 레이턴시 = fftSize 샘플(≈21ms @48k). 스테레오, 채널 독립 처리.
 * 파라미터: bypass(0/1), preset(0=gentle,1=aggressive) — port 메시지로 수신.
 */

const FFT_SIZE = 1024;
const HOP = 256; // 75% overlap
const NUM_BINS = FFT_SIZE / 2;

// ===== de-harsh.ts와 동기화 (BEGIN) =====
const dbToLinear = (db) => Math.pow(10, db / 20);
const linearToDb = (lin) => (lin > 0 ? 20 * Math.log10(lin) : -Infinity);

// 밴드(=de-harsh.ts DEFAULT_BANDS) — 저역·미드 광대역 압축 OFF, 공명 노치 중심
const RESONANCE_LOW_HZ = 1000;
const RESONANCE_HIGH_HZ = 10000;
const DEFAULT_BANDS = [
  { freqLow: 0, freqHigh: 80, attackMs: 30, releaseMs: 200, thresholdDb: -12, ratio: 2, kneeDb: 10, enabled: false },
  { freqLow: 80, freqHigh: 250, attackMs: 20, releaseMs: 150, thresholdDb: -15, ratio: 2.5, kneeDb: 8, enabled: false },
  { freqLow: 250, freqHigh: 1000, attackMs: 10, releaseMs: 100, thresholdDb: -18, ratio: 3, kneeDb: 6, enabled: false },
  { freqLow: 1000, freqHigh: 3000, attackMs: 8, releaseMs: 80, thresholdDb: -20, ratio: 3.5, kneeDb: 6, enabled: false },
  { freqLow: 3000, freqHigh: 6000, attackMs: 2, releaseMs: 40, thresholdDb: -24, ratio: 3, kneeDb: 4, enabled: true },
  { freqLow: 6000, freqHigh: 12000, attackMs: 2, releaseMs: 30, thresholdDb: -26, ratio: 3.5, kneeDb: 3, enabled: true },
  { freqLow: 12000, freqHigh: 20000, attackMs: 5, releaseMs: 50, thresholdDb: -22, ratio: 2, kneeDb: 6, enabled: false },
];

function presetBands(preset) {
  if (preset === 1) {
    return DEFAULT_BANDS.map((b) => ({ ...b, thresholdDb: b.thresholdDb - 6, ratio: b.ratio + 2 }));
  }
  return DEFAULT_BANDS.map((b) => ({ ...b, thresholdDb: b.thresholdDb + 6, ratio: Math.max(2, b.ratio - 1) }));
}
function presetParams(preset) {
  return preset === 1
    ? { sensitivity: 0.8, maxCut: -18 }
    : { sensitivity: 0.3, maxCut: -6 };
}
// ===== 동기화 (END) =====

// ---- 인플레이스 라딕스-2 FFT (실수입력) ----
function makeFFT(n) {
  const cos = new Float32Array(n / 2);
  const sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  let bits = 0;
  while (1 << bits < n) bits++;
  for (let i = 0; i < n; i++) {
    let x = i, r = 0;
    for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  // re,im 인플레이스 변환 (inverse면 부호/스케일 조정)
  function transform(re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const ci = k * step;
          let wr = cos[ci];
          let wi = inverse ? -sin[ci] : sin[ci];
          const a = i + k, b = i + k + half;
          const tr = wr * re[b] - wi * im[b];
          const ti = wr * im[b] + wi * re[b];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }
  return transform;
}

class EnvelopeFollower {
  constructor(sampleRate, attackMs, releaseMs) {
    this.attackCoef = Math.exp(-1 / ((sampleRate * attackMs) / 1000));
    this.releaseCoef = Math.exp(-1 / ((sampleRate * releaseMs) / 1000));
    this.env = 0;
  }
  process(x) {
    const abs = Math.abs(x);
    const c = abs > this.env ? this.attackCoef : this.releaseCoef;
    this.env = c * this.env + (1 - c) * abs;
    return this.env;
  }
  reset() { this.env = 0; }
}

function gainComputerDb(inputDb, thr, ratio, knee) {
  const ks = thr - knee / 2, ke = thr + knee / 2;
  if (inputDb <= ks) return 0;
  if (inputDb >= ke) { const ex = inputDb - thr; return ex / ratio - ex; }
  const kp = (inputDb - ks) / knee;
  const full = (inputDb - thr) * (1 - 1 / ratio);
  return -full * kp * kp;
}

/** 한 채널의 STFT de-harsh 상태 */
class ChannelDeHarsh {
  constructor(sampleRate, bands, params) {
    this.sr = sampleRate;
    this.bands = bands;
    this.params = params;
    this.fft = makeFFT(FFT_SIZE);
    this.window = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    this.inBuf = new Float32Array(FFT_SIZE); // 입력 슬라이딩
    this.inPos = 0;
    this.outBuf = new Float32Array(FFT_SIZE); // 오버랩-애드 누적
    this.outPos = 0;
    this.envs = bands.map((b) => new EnvelopeFollower(sampleRate, b.attackMs, b.releaseMs));
    this.avgSpec = new Float32Array(NUM_BINS);
    this.specInit = false;
    this.re = new Float32Array(FFT_SIZE);
    this.im = new Float32Array(FFT_SIZE);
    this.mag = new Float32Array(NUM_BINS);
    this.overlap = FFT_SIZE / HOP;
    this.pending = []; // 처리 완료돼 방출 대기 중인 샘플
  }
  setPreset(bands, params) {
    this.bands = bands; this.params = params;
    this.envs = bands.map((b) => new EnvelopeFollower(this.sr, b.attackMs, b.releaseMs));
  }
  bandForFreq(freq) {
    for (let i = 0; i < this.bands.length; i++)
      if (freq >= this.bands[i].freqLow && freq < this.bands[i].freqHigh) return i;
    return this.bands.length - 1;
  }
  processFrame() {
    const re = this.re, im = this.im;
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = this.frame[i] * this.window[i]; im[i] = 0; }
    this.fft(re, im, false);
    for (let b = 0; b < NUM_BINS; b++) this.mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]);

    // 밴드 에너지
    const bandE = new Float32Array(this.bands.length);
    const bandN = new Float32Array(this.bands.length);
    for (let b = 0; b < NUM_BINS; b++) {
      const f = (b * this.sr) / FFT_SIZE;
      const bi = this.bandForFreq(f);
      bandE[bi] += this.mag[b] * this.mag[b]; bandN[bi]++;
    }
    for (let i = 0; i < this.bands.length; i++) if (bandN[i] > 0) bandE[i] = Math.sqrt(bandE[i] / bandN[i]);
    const bandGain = new Float32Array(this.bands.length);
    for (let i = 0; i < this.bands.length; i++) {
      const env = this.envs[i].process(bandE[i]);
      bandGain[i] = this.bands[i].enabled === false
        ? 0
        : gainComputerDb(linearToDb(env), this.bands[i].thresholdDb, this.bands[i].ratio, this.bands[i].kneeDb);
    }
    // 공명 검출
    const resonance = new Float32Array(NUM_BINS);
    if (!this.specInit) {
      this.avgSpec.set(this.mag); this.specInit = true;
    } else {
      for (let b = 0; b < NUM_BINS; b++) {
        const m = this.mag[b];
        this.avgSpec[b] = 0.3 * m + 0.7 * this.avgSpec[b];
        const avg = this.avgSpec[b];
        if (avg > 1e-10 && m > avg * 1.5) resonance[b] = Math.min(1, (m / avg - 1.5) / 2);
      }
    }
    // 게인 적용
    const { sensitivity, maxCut } = this.params;
    for (let b = 0; b < NUM_BINS; b++) {
      const f = (b * this.sr) / FFT_SIZE;
      let gDb = bandGain[this.bandForFreq(f)];
      if (resonance[b] > 0 && f >= RESONANCE_LOW_HZ && f <= RESONANCE_HIGH_HZ) {
        gDb += maxCut * resonance[b] * sensitivity;
      }
      if (f >= 5000 && f <= 12000) gDb += gDb * 0.3;
      const g = dbToLinear(gDb);
      re[b] *= g; im[b] *= g;
      if (b > 0) { const m = FFT_SIZE - b; re[m] = re[b]; im[m] = -im[b]; }
    }
    this.fft(re, im, true);
    // 합성 윈도우 + 오버랩-애드. Hann 이중윈도우 75%중첩(hop=N/4) 정규화 = 1.5.
    const out = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) out[i] = (re[i] * this.window[i]) / 1.5;
    return out;
  }
  /** 샘플 1개 입력 → 처리된 샘플 1개 반환(룩어헤드 지연 포함) */
  pushPull(x) {
    // 입력을 슬라이딩 버퍼에 채움
    this.inBuf[this.inPos++] = x;
    // 출력 누적 버퍼에서 1샘플 꺼냄
    const y = this.outBuf[this.outPos];
    this.outBuf[this.outPos] = 0;
    this.outPos = (this.outPos + 1) % FFT_SIZE;

    if (this.inPos >= HOP) {
      // HOP 샘플 모임 → 최근 FFT_SIZE 샘플로 프레임 구성
      if (!this.frame) this.frame = new Float32Array(FFT_SIZE);
      // 프레임 = 직전 (FFT_SIZE-HOP) + 새 HOP. 슬라이딩.
      this.frame.copyWithin(0, HOP);
      this.frame.set(this.inBuf.subarray(0, HOP), FFT_SIZE - HOP);
      this.inPos = 0;
      const processed = this.processFrame();
      // 오버랩-애드: processed를 outBuf의 현재 outPos 기준 미래 구간에 더함
      for (let i = 0; i < FFT_SIZE; i++) {
        const idx = (this.outPos + i) % FFT_SIZE;
        this.outBuf[idx] += processed[i];
      }
    }
    return y;
  }
  reset() {
    this.inBuf.fill(0); this.outBuf.fill(0); this.inPos = 0; this.outPos = 0;
    this.avgSpec.fill(0); this.specInit = false;
    this.envs.forEach((e) => e.reset());
    if (this.frame) this.frame.fill(0);
  }
}

class DeHarshProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bypass = true;
    this.preset = 0;
    this.chans = null;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.bypass === "number") this.bypass = d.bypass !== 0;
      if (typeof d.preset === "number") {
        this.preset = d.preset;
        if (this.chans) {
          const bands = presetBands(this.preset);
          const params = presetParams(this.preset);
          this.chans.forEach((c) => c.setPreset(bands, params));
        }
      }
      if (d.type === "reset" && this.chans) this.chans.forEach((c) => c.reset());
    };
  }
  ensure(numCh) {
    if (this.chans && this.chans.length === numCh) return;
    const bands = presetBands(this.preset);
    const params = presetParams(this.preset);
    this.chans = [];
    for (let c = 0; c < numCh; c++) this.chans.push(new ChannelDeHarsh(sampleRate, bands, params));
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const numCh = output.length;
    const frames = output[0].length;

    if (this.bypass) {
      for (let c = 0; c < numCh; c++) {
        const inC = input[c] || input[0];
        output[c].set(inC.subarray(0, frames));
      }
      return true;
    }
    this.ensure(numCh);
    for (let c = 0; c < numCh; c++) {
      const inC = input[c] || input[0];
      const outC = output[c];
      const ch = this.chans[c];
      for (let i = 0; i < frames; i++) outC[i] = ch.pushPull(inC[i]);
    }
    return true;
  }
}

registerProcessor("de-harsh-processor", DeHarshProcessor);
