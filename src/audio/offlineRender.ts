/**
 * Offline render (export + full LUFS measurement) — ported verbatim from `sf`.
 * Graph: HPF → EQ → multiband(parallel) → glue comp → gain, rendered in an
 * OfflineAudioContext at the source's native sample rate; then post-render JS
 * passes: de-harsh → clipper(drive→limiter) → makeup → true-peak limiter → −0.1 dB.
 */
import { createLimiter, dbToLin } from './limiterCore'
import { applyDeHarsh } from './deharshCore'
import type { MasteringChain } from './types'

const BLOCK = 128

/** Two cascaded biquads (Q 0.707) = 4th-order Linkwitz-Riley crossover leg. */
function crossover(ctx: OfflineAudioContext, type: BiquadFilterType, freq: number) {
  const a = ctx.createBiquadFilter()
  a.type = type
  a.Q.value = 0.707
  a.frequency.value = freq
  const b = ctx.createBiquadFilter()
  b.type = type
  b.Q.value = 0.707
  b.frequency.value = freq
  a.connect(b)
  return { a, b }
}

function makeComp(ctx: OfflineAudioContext, band: { threshold: number; ratio: number; attack: number; release: number; knee: number }) {
  const c = ctx.createDynamicsCompressor()
  c.threshold.value = band.threshold
  c.ratio.value = band.ratio
  c.attack.value = band.attack
  c.release.value = band.release
  c.knee.value = band.knee
  return c
}

/** Process a whole buffer through a limiter instance in 128-frame blocks (in place). */
function runLimiterPass(
  channels: Float32Array[],
  lim: ReturnType<typeof createLimiter>,
  driveLin: number,
): void {
  const L = channels[0]
  const R = channels.length > 1 ? channels[1] : channels[0]
  const stereo = channels.length > 1
  const total = L.length
  const tmpL = new Float32Array(BLOCK)
  const tmpR = new Float32Array(BLOCK)
  const inL = driveLin !== 1 ? new Float32Array(BLOCK) : null
  const inR = driveLin !== 1 ? new Float32Array(BLOCK) : null
  for (let off = 0; off < total; off += BLOCK) {
    const n = Math.min(BLOCK, total - off)
    let srcL = L.subarray(off, off + n)
    let srcR = R.subarray(off, off + n)
    if (inL && inR) {
      for (let i = 0; i < n; i++) {
        inL[i] = srcL[i] * driveLin
        inR[i] = srcR[i] * driveLin
      }
      srcL = inL.subarray(0, n)
      srcR = inR.subarray(0, n)
    }
    const oL = tmpL.subarray(0, n)
    const oR = tmpR.subarray(0, n)
    lim.processBlock(srcL, srcR, oL, oR, n)
    L.set(oL, off)
    if (stereo) R.set(oR, off)
  }
}

export async function renderMastered(buffer: AudioBuffer, chain: MasteringChain): Promise<AudioBuffer> {
  const channels = Math.min(2, buffer.numberOfChannels)
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length: buffer.length, sampleRate: buffer.sampleRate })
  const src = ctx.createBufferSource()
  src.buffer = buffer

  const hpf = ctx.createBiquadFilter()
  hpf.type = 'highpass'
  hpf.frequency.value = chain.eq.hpfFreq
  hpf.Q.value = 0.707

  const eqNodes = chain.eq.bands.map((band) => {
    const f = ctx.createBiquadFilter()
    f.type = band.type
    f.frequency.value = band.freq
    f.gain.value = band.gain
    f.Q.value = band.q
    return f
  })

  const lowLp = crossover(ctx, 'lowpass', chain.mb.crossoverLow)
  const midHp = crossover(ctx, 'highpass', chain.mb.crossoverLow)
  const midLp = crossover(ctx, 'lowpass', chain.mb.crossoverHigh)
  const highHp = crossover(ctx, 'highpass', chain.mb.crossoverHigh)
  const compLow = makeComp(ctx, chain.mb.bands[0])
  const compMid = makeComp(ctx, chain.mb.bands[1])
  const compHigh = makeComp(ctx, chain.mb.bands[2])
  const mbSum = ctx.createGain()

  const glue = ctx.createDynamicsCompressor()
  glue.threshold.value = chain.comp.threshold
  glue.ratio.value = chain.comp.ratio
  glue.attack.value = chain.comp.attack
  glue.release.value = chain.comp.release
  glue.knee.value = chain.comp.knee

  const tail = ctx.createGain()
  tail.gain.value = 1

  let node: AudioNode = src
  if (!chain.eq.hpfBypassed && !chain.eq.bypassed) {
    node.connect(hpf)
    node = hpf
  }
  if (!chain.eq.bypassed && eqNodes.length > 0) {
    node.connect(eqNodes[0])
    for (let i = 0; i < eqNodes.length - 1; i++) eqNodes[i].connect(eqNodes[i + 1])
    node = eqNodes[eqNodes.length - 1]
  }
  if (!chain.mb.bypassed) {
    node.connect(lowLp.a)
    lowLp.b.connect(compLow)
    compLow.connect(mbSum)
    node.connect(midHp.a)
    midHp.b.connect(midLp.a)
    midLp.b.connect(compMid)
    compMid.connect(mbSum)
    node.connect(highHp.a)
    highHp.b.connect(compHigh)
    compHigh.connect(mbSum)
    node = mbSum
  }
  if (!chain.comp.bypassed) {
    node.connect(glue)
    node = glue
  }
  node.connect(tail)
  tail.connect(ctx.destination)
  src.start(0)

  let rendered = await ctx.startRendering()

  if (!chain.deHarsh.bypassed) {
    rendered = applyDeHarsh(rendered, chain.deHarsh.preset)
  }

  const data: Float32Array[] = []
  for (let c = 0; c < rendered.numberOfChannels; c++) data.push(rendered.getChannelData(c))

  // Clipper (peak tamer): drive into a gentle limiter at thresholdDb.
  if (!chain.peakStage.bypassed) {
    const clip = createLimiter({
      sampleRate: rendered.sampleRate,
      ceilingDb: chain.peakStage.thresholdDb,
      lookaheadMs: 1,
      attackMs: 1,
      releaseMs: 30,
    })
    runLimiterPass(data, clip, dbToLin(chain.peakStage.driveDb))
  }

  // Makeup gain (linear).
  const makeup = dbToLin(chain.autoMakeupDb + chain.comp.makeup + chain.userMakeupDb)
  if (makeup !== 1) {
    for (const ch of data) for (let i = 0; i < ch.length; i++) ch[i] *= makeup
  }

  // True-peak limiter.
  if (!chain.limiter.bypassed) {
    const lim = createLimiter({
      sampleRate: rendered.sampleRate,
      ceilingDb: chain.limiter.ceiling,
      lookaheadMs: chain.limiter.lookaheadMs,
      attackMs: chain.limiter.attackMs,
      releaseMs: chain.limiter.release * 1000,
    })
    runLimiterPass(data, lim, 1)
  }

  // Safety gain −0.1 dB.
  const safety = dbToLin(-0.1)
  for (const ch of data) for (let i = 0; i < ch.length; i++) ch[i] *= safety

  return rendered
}
