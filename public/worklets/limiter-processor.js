/**
 * AudioWorkletProcessor — 라이브 경로의 트루피크 룩어헤드 리미터.
 *
 * ⚠️ 자체 포함(self-contained): 워크렛은 격리된 글로벌 스코프에서 실행되고
 *    Vite가 워크렛 자산의 상대 import(`./limiter-core.js`)를 번들링하지 않으므로,
 *    리미터 코어 로직을 여기 직접 인라인한다.
 *
 *    이 createLimiter / FIR 정의는 limiter-core.js와 반드시 동일해야 한다
 *    (라이브==오프라인 동등성). 한쪽을 고치면 다른 쪽도 같이 고칠 것.
 *    오프라인/측정 경로는 limiter-core.js를 일반 import로 사용한다.
 */

// ===== limiter-core.js와 동기화 (BEGIN) =====
const OS_TAPS = 8;
const OS_FACTOR = 4;
// prettier-ignore
const FIR = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 0,
  0.0110, -0.0467, 0.1326, 0.9709, -0.0974, 0.0353, -0.0095, 0.0038,
  0.0155, -0.0663, 0.2014, 0.8499, 0.2014, -0.0663, 0.0155, -0.0050,
  0.0038, -0.0095, 0.0353, -0.0974, 0.9709, 0.1326, -0.0467, 0.0110,
]);

function dbToLin(db) {
  return Math.pow(10, db / 20);
}
function coefFromMs(ms, sampleRate) {
  if (ms <= 0) return 0;
  return Math.exp(-1 / ((ms / 1000) * sampleRate));
}

function createLimiter(opts) {
  const sampleRate = opts.sampleRate;
  let ceilingLin = dbToLin(opts.ceilingDb ?? -1);
  let lookaheadSamples = Math.max(
    1,
    Math.round(((opts.lookaheadMs ?? 1.5) / 1000) * sampleRate)
  );
  let attackCoef = coefFromMs(opts.attackMs ?? 1, sampleRate);
  let releaseCoef = coefFromMs(opts.releaseMs ?? 50, sampleRate);

  let delayL = new Float32Array(lookaheadSamples);
  let delayR = new Float32Array(lookaheadSamples);
  let writeIdx = 0;
  const histL = new Float32Array(OS_TAPS);
  const histR = new Float32Array(OS_TAPS);
  let env = 1;

  function rebuildDelay(newLen) {
    if (newLen === lookaheadSamples) return;
    lookaheadSamples = newLen;
    delayL = new Float32Array(lookaheadSamples);
    delayR = new Float32Array(lookaheadSamples);
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
    if (p.lookaheadMs != null) {
      rebuildDelay(Math.max(1, Math.round((p.lookaheadMs / 1000) * sampleRate)));
    }
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
// ===== limiter-core.js와 동기화 (END) =====

class LimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "ceilingDb", defaultValue: -1, minValue: -12, maxValue: 0, automationRate: "k-rate" },
      { name: "releaseMs", defaultValue: 50, minValue: 1, maxValue: 500, automationRate: "k-rate" },
      { name: "lookaheadMs", defaultValue: 1.5, minValue: 0, maxValue: 10, automationRate: "k-rate" },
      { name: "attackMs", defaultValue: 1, minValue: 0, maxValue: 50, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.lim = createLimiter({
      sampleRate,
      ceilingDb: -1,
      lookaheadMs: 1.5,
      attackMs: 1,
      releaseMs: 50,
    });
    this._last = { ceilingDb: -1, releaseMs: 50, lookaheadMs: 1.5, attackMs: 1 };
    this._grHold = 0;
    this._quanta = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "reset") this.lim.reset();
    };
  }

  _syncParams(params) {
    const patch = {};
    let changed = false;
    for (const key of ["ceilingDb", "releaseMs", "lookaheadMs", "attackMs"]) {
      const v = params[key][0];
      if (v !== this._last[key]) {
        patch[key] = v;
        this._last[key] = v;
        changed = true;
      }
    }
    if (changed) this.lim.setParams(patch);
  }

  process(inputs, outputs, params) {
    this._syncParams(params);
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      this.port.postMessage({ gr: 0 });
      return true;
    }
    const frames = output[0].length;
    const inL = input[0];
    const inR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];

    const grDb = this.lim.processBlock(inL, inR, outL, outR, frames);
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

registerProcessor("limiter-processor", LimiterProcessor);
