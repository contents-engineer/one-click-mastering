/**
 * True-peak look-ahead limiter core (offline / measurement path).
 *
 * MUST stay identical to `public/worklets/limiter-processor.js` (live == offline
 * equivalence). The 4× oversampling polyphase FIR and the gain math are shared.
 * Ported verbatim from the original Manex limiter-core.
 */

export const OS_TAPS = 8
export const OS_FACTOR = 4
// 4× oversampling polyphase FIR (8 taps per phase) for inter-sample (true) peak detection.
// Shared by the limiter and the true-peak meter (`truePeakDb`).
// prettier-ignore
export const TRUE_PEAK_FIR = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 0,
  0.0110, -0.0467, 0.1326, 0.9709, -0.0974, 0.0353, -0.0095, 0.0038,
  0.0155, -0.0663, 0.2014, 0.8499, 0.2014, -0.0663, 0.0155, -0.0050,
  0.0038, -0.0095, 0.0353, -0.0974, 0.9709, 0.1326, -0.0467, 0.0110,
])

export const dbToLin = (db: number): number => Math.pow(10, db / 20)
export const linToDb = (lin: number): number => (lin > 0 ? 20 * Math.log10(lin) : -Infinity)

export function coefFromMs(ms: number, sampleRate: number): number {
  if (ms <= 0) return 0
  return Math.exp(-1 / ((ms / 1000) * sampleRate))
}

export interface LimiterOptions {
  sampleRate: number
  ceilingDb?: number
  lookaheadMs?: number
  attackMs?: number
  releaseMs?: number
}

export interface LimiterParams {
  ceilingDb?: number
  attackMs?: number
  releaseMs?: number
  lookaheadMs?: number
}

export function createLimiter(opts: LimiterOptions) {
  const sampleRate = opts.sampleRate
  let ceilingLin = dbToLin(opts.ceilingDb ?? -1)
  let lookaheadSamples = Math.max(1, Math.round(((opts.lookaheadMs ?? 1.5) / 1000) * sampleRate))
  // `attackMs` is accepted for API/automation compatibility but intentionally
  // unused: the look-ahead window-minimum below gives anticipated (click-free)
  // attack on its own — the gain is fully reduced before the peak is emitted.
  let releaseCoef = coefFromMs(opts.releaseMs ?? 50, sampleRate)

  let delayL = new Float32Array(lookaheadSamples)
  let delayR = new Float32Array(lookaheadSamples)
  let writeIdx = 0
  const histL = new Float32Array(OS_TAPS)
  const histR = new Float32Array(OS_TAPS)
  let env = 1

  // Monotonic (ascending) ring-buffer deque of the target gains across the
  // look-ahead window. `env` tracks the window MINIMUM with instant attack and
  // smoothed release, so the gain is already reduced before any inter-sample
  // (true) peak in the window reaches the delayed output. This controls the
  // TRUE peak, not just the sample peak; the per-sample clamp below is only a
  // belt-and-braces safety. (Previously a one-pole attack lagged the peaks, so
  // the clamp did the work and inter-sample peaks rode over the ceiling.)
  let dqVal = new Float32Array(lookaheadSamples + 1)
  let dqIdx = new Float64Array(lookaheadSamples + 1)
  let dqHead = 0
  let dqTail = 0
  let dqCount = 0
  let sampleIdx = 0

  function rebuildDelay(newLen: number) {
    if (newLen === lookaheadSamples) return
    lookaheadSamples = newLen
    delayL = new Float32Array(lookaheadSamples)
    delayR = new Float32Array(lookaheadSamples)
    dqVal = new Float32Array(lookaheadSamples + 1)
    dqIdx = new Float64Array(lookaheadSamples + 1)
    writeIdx = 0
    dqHead = 0
    dqTail = 0
    dqCount = 0
    sampleIdx = 0
    env = 1
  }

  function processBlock(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    frames: number,
  ): number {
    let minGain = 1
    const cap = lookaheadSamples + 1
    for (let i = 0; i < frames; i++) {
      const sL = inL[i]
      const sR = inR[i]
      let peak = 0
      for (let t = 0; t < OS_TAPS - 1; t++) {
        histL[t] = histL[t + 1]
        histR[t] = histR[t + 1]
      }
      histL[OS_TAPS - 1] = sL
      histR[OS_TAPS - 1] = sR
      for (let p = 0; p < OS_FACTOR; p++) {
        const base = p * OS_TAPS
        let aL = 0
        let aR = 0
        for (let t = 0; t < OS_TAPS; t++) {
          const cf = TRUE_PEAK_FIR[base + t]
          aL += cf * histL[t]
          aR += cf * histR[t]
        }
        if (aL < 0) aL = -aL
        if (aR < 0) aR = -aR
        if (aL > peak) peak = aL
        if (aR > peak) peak = aR
      }
      const target = peak > ceilingLin ? ceilingLin / peak : 1

      // sliding-window minimum of the target gain over the look-ahead window
      while (dqCount > 0 && dqVal[(dqTail - 1 + cap) % cap] >= target) {
        dqTail = (dqTail - 1 + cap) % cap
        dqCount--
      }
      dqVal[dqTail] = target
      dqIdx[dqTail] = sampleIdx
      dqTail = (dqTail + 1) % cap
      dqCount++
      while (dqCount > 0 && dqIdx[dqHead] <= sampleIdx - lookaheadSamples) {
        dqHead = (dqHead + 1) % cap
        dqCount--
      }
      const windowMin = dqVal[dqHead]
      if (windowMin < env) env = windowMin // instant attack to the anticipated minimum
      else env = windowMin + (env - windowMin) * releaseCoef // smoothed release
      if (env < minGain) minGain = env

      const dL = delayL[writeIdx]
      const dR = delayR[writeIdx]
      delayL[writeIdx] = sL
      delayR[writeIdx] = sR
      writeIdx = writeIdx + 1 >= lookaheadSamples ? 0 : writeIdx + 1

      let oL = dL * env
      let oR = dR * env
      if (oL > ceilingLin) oL = ceilingLin
      else if (oL < -ceilingLin) oL = -ceilingLin
      if (oR > ceilingLin) oR = ceilingLin
      else if (oR < -ceilingLin) oR = -ceilingLin
      outL[i] = oL
      outR[i] = oR
      sampleIdx++
    }
    return minGain > 0 ? 20 * Math.log10(minGain) : -120
  }

  function setParams(p: LimiterParams) {
    if (p.ceilingDb != null) ceilingLin = dbToLin(p.ceilingDb)
    if (p.releaseMs != null) releaseCoef = coefFromMs(p.releaseMs, sampleRate)
    if (p.lookaheadMs != null) {
      rebuildDelay(Math.max(1, Math.round((p.lookaheadMs / 1000) * sampleRate)))
    }
    // p.attackMs intentionally ignored — see note at the top of createLimiter.
  }

  function reset() {
    delayL.fill(0)
    delayR.fill(0)
    histL.fill(0)
    histR.fill(0)
    writeIdx = 0
    env = 1
    dqHead = 0
    dqTail = 0
    dqCount = 0
    sampleIdx = 0
  }

  return { processBlock, setParams, reset }
}

/**
 * Apply the limiter to a whole rendered buffer in place, processing in 128-frame
 * blocks (state persists across blocks). Mono buffers reuse the L channel.
 * Returns the max gain-reduction in dB observed.
 */
export function limitBuffer(
  channels: Float32Array[],
  sampleRate: number,
  opts: { ceilingDb: number; lookaheadMs: number; attackMs: number; releaseMs: number },
): number {
  const lim = createLimiter({ sampleRate, ...opts })
  const L = channels[0]
  const R = channels.length > 1 ? channels[1] : channels[0]
  const total = L.length
  const BLOCK = 128
  let maxGr = 0
  const tmpL = new Float32Array(BLOCK)
  const tmpR = new Float32Array(BLOCK)
  for (let off = 0; off < total; off += BLOCK) {
    const n = Math.min(BLOCK, total - off)
    const inL = L.subarray(off, off + n)
    const inR = R.subarray(off, off + n)
    const oL = tmpL.subarray(0, n)
    const oR = tmpR.subarray(0, n)
    const gr = lim.processBlock(inL, inR, oL, oR, n)
    if (gr < maxGr) maxGr = gr
    L.set(oL, off)
    if (channels.length > 1) R.set(oR, off)
  }
  return maxGr
}
