/**
 * 피크 테이머 AudioWorkletProcessor — 라이브용.
 *
 * 클린 마스터링: 클리퍼(하모닉 추가) 대신 젠틀 트루피크 리미터로 가장 큰 피크만
 * 살짝 깎아 크레스트 팩터를 줄인다(직렬 리미팅, 하모닉 0).
 *
 * ⚠️ 자체 포함: createLimiter 인라인(limiter-worklet/core와 동일 FIR·로직).
 *    drive = 입력 게인(dB) → 젠틀 리미터(천장=threshold). registerProcessor 이름은
 *    기존 배선 호환 위해 'clipper-processor' 유지.
 */

// ===== limiter-core와 동기화 (BEGIN) =====
const OS_TAPS = 8;
const OS_FACTOR = 4;
// prettier-ignore
const FIR = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 0,
  0.0110, -0.0467, 0.1326, 0.9709, -0.0974, 0.0353, -0.0095, 0.0038,
  0.0155, -0.0663, 0.2014, 0.8499, 0.2014, -0.0663, 0.0155, -0.0050,
  0.0038, -0.0095, 0.0353, -0.0974, 0.9709, 0.1326, -0.0467, 0.0110,
]);

const dbToLin = (db) => Math.pow(10, db / 20);
function coefFromMs(ms, sampleRate) {
  if (ms <= 0) return 0;
  return Math.exp(-1 / ((ms / 1000) * sampleRate));
}

function createLimiter(opts) {
  const sampleRate = opts.sampleRate;
  let ceilingLin = dbToLin(opts.ceilingDb ?? -1);
  let lookaheadSamples = Math.max(1, Math.round(((opts.lookaheadMs ?? 1.5) / 1000) * sampleRate));
  let attackCoef = coefFromMs(opts.attackMs ?? 1, sampleRate);
  let releaseCoef = coefFromMs(opts.releaseMs ?? 50, sampleRate);
  let delayL = new Float32Array(lookaheadSamples);
  let delayR = new Float32Array(lookaheadSamples);
  let writeIdx = 0;
  const histL = new Float32Array(OS_TAPS);
  const histR = new Float32Array(OS_TAPS);
  let env = 1;
  function rebuildDelay(n) {
    if (n === lookaheadSamples) return;
    lookaheadSamples = n;
    delayL = new Float32Array(n);
    delayR = new Float32Array(n);
    writeIdx = 0;
  }
  function processBlock(inL, inR, outL, outR, frames) {
    let minGain = 1;
    for (let i = 0; i < frames; i++) {
      const sL = inL[i];
      const sR = inR[i];
      let peak = 0;
      for (let t = 0; t < OS_TAPS - 1; t++) {
        histL[t] = histL[t + 1];
        histR[t] = histR[t + 1];
      }
      histL[OS_TAPS - 1] = sL;
      histR[OS_TAPS - 1] = sR;
      for (let p = 0; p < OS_FACTOR; p++) {
        const base = p * OS_TAPS;
        let aL = 0;
        let aR = 0;
        for (let t = 0; t < OS_TAPS; t++) {
          const cf = FIR[base + t];
          aL += cf * histL[t];
          aR += cf * histR[t];
        }
        if (aL < 0) aL = -aL;
        if (aR < 0) aR = -aR;
        if (aL > peak) peak = aL;
        if (aR > peak) peak = aR;
      }
      const target = peak > ceilingLin ? ceilingLin / peak : 1;
      if (target < env) env = target + (env - target) * attackCoef;
      else env = target + (env - target) * releaseCoef;
      if (env < minGain) minGain = env;
      const dL = delayL[writeIdx];
      const dR = delayR[writeIdx];
      delayL[writeIdx] = sL;
      delayR[writeIdx] = sR;
      writeIdx = writeIdx + 1 >= lookaheadSamples ? 0 : writeIdx + 1;
      let oL = dL * env;
      let oR = dR * env;
      if (oL > ceilingLin) oL = ceilingLin;
      else if (oL < -ceilingLin) oL = -ceilingLin;
      if (oR > ceilingLin) oR = ceilingLin;
      else if (oR < -ceilingLin) oR = -ceilingLin;
      outL[i] = oL;
      outR[i] = oR;
    }
    return minGain > 0 ? 20 * Math.log10(minGain) : -120;
  }
  function setParams(p) {
    if (p.ceilingDb != null) ceilingLin = dbToLin(p.ceilingDb);
    if (p.attackMs != null) attackCoef = coefFromMs(p.attackMs, sampleRate);
    if (p.releaseMs != null) releaseCoef = coefFromMs(p.releaseMs, sampleRate);
    if (p.lookaheadMs != null) rebuildDelay(Math.max(1, Math.round((p.lookaheadMs / 1000) * sampleRate)));
  }
  function reset() {
    delayL.fill(0);
    delayR.fill(0);
    histL.fill(0);
    histR.fill(0);
    writeIdx = 0;
    env = 1;
  }
  return { processBlock, setParams, reset };
}
// ===== 동기화 (END) =====

class ClipperProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "thresholdDb", defaultValue: -3, minValue: -12, maxValue: 0, automationRate: "k-rate" },
      { name: "driveDb", defaultValue: 0, minValue: 0, maxValue: 12, automationRate: "k-rate" },
    ];
  }
  constructor() {
    super();
    this.bypass = true;
    this.driveLin = 1;
    this.lim = createLimiter({
      sampleRate,
      ceilingDb: -3,
      lookaheadMs: 1.0,
      attackMs: 1.0,
      releaseMs: 30, // 짧은 release — 펌핑/breathing 방지
    });
    this._last = { thresholdDb: -3, driveDb: 0 };
    this._grHold = 0;
    this._quanta = 0;
    this._tmpL = new Float32Array(128);
    this._tmpR = new Float32Array(128);
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.bypass === "number") this.bypass = d.bypass !== 0;
      if (d.type === "reset") this.lim.reset();
    };
  }
  _sync(params) {
    const th = params.thresholdDb[0];
    const dr = params.driveDb[0];
    if (th !== this._last.thresholdDb) {
      this.lim.setParams({ ceilingDb: th });
      this._last.thresholdDb = th;
    }
    if (dr !== this._last.driveDb) {
      this.driveLin = dbToLin(dr);
      this._last.driveDb = dr;
    }
  }
  process(inputs, outputs, params) {
    this._sync(params);
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const frames = output[0].length;
    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];

    if (this.bypass) {
      outL.set(inL.subarray(0, frames));
      if (output.length > 1) outR.set(inR.subarray(0, frames));
      this.port.postMessage({ gr: 0 });
      return true;
    }

    if (this._tmpL.length < frames) {
      this._tmpL = new Float32Array(frames);
      this._tmpR = new Float32Array(frames);
    }
    const g = this.driveLin;
    for (let i = 0; i < frames; i++) {
      this._tmpL[i] = inL[i] * g;
      this._tmpR[i] = inR[i] * g;
    }
    const grDb = this.lim.processBlock(this._tmpL, this._tmpR, outL, outR, frames);
    if (grDb < this._grHold) this._grHold = grDb;
    this._quanta++;
    if (this._quanta >= 37) {
      this.port.postMessage({ gr: this._grHold });
      this._grHold = 0;
      this._quanta = 0;
    }
    return true;
  }
}

registerProcessor("clipper-processor", ClipperProcessor);
