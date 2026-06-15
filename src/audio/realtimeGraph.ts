/**
 * Realtime mastering graph for live A/B preview (ported from `Pm`).
 * MediaElementSource → HPF → EQ → multiband → glue comp → de-harsh → clipper →
 * makeup → limiter → −0.1 dB safety → destination. Each stage has a wet/dry
 * crossfade for click-free bypass; global bypass swaps wet/dry output for instant
 * Before/After. K-weighted analyser taps feed the live LUFS meters.
 */
import { dbToLin } from './limiterCore'
import type { MasteringChain } from './types'

const WORKLET_LIMITER = '/worklets/limiter-processor.js'
const WORKLET_DEHARSH = '/worklets/de-harsh-processor.js'
const WORKLET_CLIPPER = '/worklets/clipper-processor.js'

// K-weighting biquads for the realtime loudness taps (BS.1770).
const K_SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] }
const K_HPF = { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] }

const SMOOTH = 0.005

interface CrossFade {
  wet: GainNode
  dry: GainNode
  out: GainNode
}

interface Split {
  a: BiquadFilterNode
  b: BiquadFilterNode
}

function makeCrossFade(ctx: BaseAudioContext): CrossFade {
  const wet = ctx.createGain()
  wet.gain.value = 1
  const dry = ctx.createGain()
  dry.gain.value = 0
  const out = ctx.createGain()
  out.gain.value = 1
  return { wet, dry, out }
}

function setBypass(cf: CrossFade, bypassed: boolean, t: number) {
  cf.wet.gain.setTargetAtTime(bypassed ? 0 : 1, t, SMOOTH)
  cf.dry.gain.setTargetAtTime(bypassed ? 1 : 0, t, SMOOTH)
}

function makeSplit(ctx: BaseAudioContext, type: BiquadFilterType): Split {
  const a = ctx.createBiquadFilter()
  a.type = type
  a.Q.value = 0.707
  const b = ctx.createBiquadFilter()
  b.type = type
  b.Q.value = 0.707
  a.connect(b)
  return { a, b }
}

function setSplitFreq(s: Split, freq: number, t: number) {
  s.a.frequency.setTargetAtTime(freq, t, SMOOTH)
  s.b.frequency.setTargetAtTime(freq, t, SMOOTH)
}

function setComp(c: DynamicsCompressorNode, band: { threshold: number; ratio: number; attack: number; release: number; knee: number }, t: number) {
  c.threshold.setTargetAtTime(band.threshold, t, SMOOTH)
  c.ratio.setTargetAtTime(band.ratio, t, SMOOTH)
  c.attack.setTargetAtTime(band.attack, t, SMOOTH)
  c.release.setTargetAtTime(band.release, t, SMOOTH)
  c.knee.setTargetAtTime(band.knee, t, SMOOTH)
}

export interface GraphAnalysers {
  beforeL: AnalyserNode
  beforeR: AnalyserNode
  afterL: AnalyserNode
  afterR: AnalyserNode
  beforePeak: AnalyserNode
  afterPeak: AnalyserNode
}

export class MasteringGraph {
  ctx: AudioContext
  sampleRate: number
  ready = false
  private started = false
  private el: HTMLMediaElement
  private source: MediaElementAudioSourceNode | null = null

  // nodes
  private input!: GainNode
  private wetOut!: GainNode
  private dryOut!: GainNode
  private hpf!: BiquadFilterNode
  private hpfBypass!: CrossFade
  private eqBands!: BiquadFilterNode[]
  private eqBypass!: CrossFade
  private comp!: DynamicsCompressorNode
  private compBypass!: CrossFade
  private mb!: { splitLow: Split; splitMidHP: Split; splitMidLP: Split; splitHigh: Split; compLow: DynamicsCompressorNode; compMid: DynamicsCompressorNode; compHigh: DynamicsCompressorNode; sum: GainNode }
  private mbBypass!: CrossFade
  private deHarsh: AudioWorkletNode | null = null
  private clipper: AudioWorkletNode | null = null
  private makeup!: GainNode
  private limiter!: AudioWorkletNode | DynamicsCompressorNode
  private limiterIsWorklet = false
  private limiterBypass!: CrossFade
  private safety!: GainNode

  analysers!: GraphAnalysers
  limiterGrDb = 0
  clipperGrDb = 0

  constructor(el: HTMLMediaElement) {
    this.el = el
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctor()
    this.sampleRate = this.ctx.sampleRate
  }

  /** Lazily build the graph on the first user gesture; resume if suspended. */
  async ensureStarted(): Promise<void> {
    if (this.started) {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    this.started = true
    const ctx = this.ctx

    let limiterOk = false
    try {
      await ctx.audioWorklet.addModule(WORKLET_LIMITER)
      limiterOk = true
    } catch (e) {
      console.warn('AudioWorklet limiter 로드 실패 — 컴프레서 폴백:', e)
    }
    let deHarshOk = false
    try {
      await ctx.audioWorklet.addModule(WORKLET_DEHARSH)
      deHarshOk = true
    } catch (e) {
      console.warn('AudioWorklet de-harsh 로드 실패 — 라이브 미적용:', e)
    }
    let clipperOk = false
    try {
      await ctx.audioWorklet.addModule(WORKLET_CLIPPER)
      clipperOk = true
    } catch (e) {
      console.warn('AudioWorklet clipper 로드 실패 — 라이브 미적용:', e)
    }

    this.input = ctx.createGain()
    this.wetOut = ctx.createGain()
    this.dryOut = ctx.createGain()
    this.dryOut.gain.value = 0
    this.hpf = ctx.createBiquadFilter()
    this.hpf.type = 'highpass'
    this.hpf.Q.value = 0.707
    this.hpfBypass = makeCrossFade(ctx)

    this.eqBands = []
    for (let i = 0; i < 12; i++) {
      const b = ctx.createBiquadFilter()
      b.type = 'peaking'
      b.gain.value = 0
      b.Q.value = 0.7
      b.frequency.value = 1000
      this.eqBands.push(b)
    }
    this.eqBypass = makeCrossFade(ctx)
    this.comp = ctx.createDynamicsCompressor()
    this.compBypass = makeCrossFade(ctx)

    this.mb = {
      splitLow: makeSplit(ctx, 'lowpass'),
      splitMidHP: makeSplit(ctx, 'highpass'),
      splitMidLP: makeSplit(ctx, 'lowpass'),
      splitHigh: makeSplit(ctx, 'highpass'),
      compLow: ctx.createDynamicsCompressor(),
      compMid: ctx.createDynamicsCompressor(),
      compHigh: ctx.createDynamicsCompressor(),
      sum: ctx.createGain(),
    }
    this.mbBypass = makeCrossFade(ctx)

    const workletOpts: AudioWorkletNodeOptions = {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    }
    this.deHarsh = deHarshOk ? new AudioWorkletNode(ctx, 'de-harsh-processor', workletOpts) : null
    this.clipper = clipperOk ? new AudioWorkletNode(ctx, 'clipper-processor', workletOpts) : null
    if (this.clipper) {
      this.clipper.port.onmessage = (e) => {
        if (e.data && typeof e.data.gr === 'number') this.clipperGrDb = e.data.gr
      }
    }
    this.makeup = ctx.createGain()

    if (limiterOk) {
      const lim = new AudioWorkletNode(ctx, 'limiter-processor', workletOpts)
      lim.port.onmessage = (e) => {
        if (e.data && typeof e.data.gr === 'number') this.limiterGrDb = e.data.gr
      }
      this.limiter = lim
      this.limiterIsWorklet = true
    } else {
      const comp = ctx.createDynamicsCompressor()
      comp.ratio.value = 20
      comp.attack.value = 0.001
      comp.knee.value = 0
      this.limiter = comp
    }
    this.limiterBypass = makeCrossFade(ctx)
    this.safety = ctx.createGain()
    this.safety.gain.value = dbToLin(-0.1)

    const analyser16k = () => {
      const a = ctx.createAnalyser()
      a.fftSize = 16384
      a.smoothingTimeConstant = 0
      return a
    }
    const beforeL = analyser16k()
    const beforeR = analyser16k()
    const afterL = analyser16k()
    const afterR = analyser16k()
    const beforePeak = ctx.createAnalyser()
    beforePeak.fftSize = 2048
    beforePeak.smoothingTimeConstant = 0
    const afterPeak = ctx.createAnalyser()
    afterPeak.fftSize = 2048
    afterPeak.smoothingTimeConstant = 0
    this.analysers = { beforeL, beforeR, afterL, afterR, beforePeak, afterPeak }

    // K-weighting tap: split to L/R, run each through the two IIR biquads, into the analysers.
    const kTap = (src: AudioNode, outL: AnalyserNode, outR: AnalyserNode) => {
      const splitter = ctx.createChannelSplitter(2)
      src.connect(splitter)
      const outs = [outL, outR]
      for (let c = 0; c < 2; c++) {
        const shelf = ctx.createIIRFilter(K_SHELF.b, K_SHELF.a)
        const hpf = ctx.createIIRFilter(K_HPF.b, K_HPF.a)
        splitter.connect(shelf, c, 0)
        shelf.connect(hpf)
        hpf.connect(outs[c])
      }
    }

    try {
      this.source = ctx.createMediaElementSource(this.el)
    } catch (e) {
      console.warn('MediaElementSource skip:', e)
    }
    const src = this.source as AudioNode
    src.connect(this.input)
    src.connect(this.dryOut)
    src.connect(beforePeak)
    kTap(src, beforeL, beforeR)

    // wiring
    const E = this.hpfBypass
    const B = this.eqBypass
    const X = this.mbBypass
    const L = this.compBypass
    const se = this.limiterBypass
    this.input.connect(E.wet)
    E.wet.connect(this.hpf)
    this.hpf.connect(E.out)
    this.input.connect(E.dry)
    E.dry.connect(E.out)
    E.out.connect(B.wet)
    B.wet.connect(this.eqBands[0])
    for (let i = 0; i < this.eqBands.length - 1; i++) this.eqBands[i].connect(this.eqBands[i + 1])
    this.eqBands[this.eqBands.length - 1].connect(B.out)
    E.out.connect(B.dry)
    B.dry.connect(B.out)
    B.out.connect(X.wet)
    X.wet.connect(this.mb.splitLow.a)
    this.mb.splitLow.b.connect(this.mb.compLow)
    this.mb.compLow.connect(this.mb.sum)
    X.wet.connect(this.mb.splitMidHP.a)
    this.mb.splitMidHP.b.connect(this.mb.splitMidLP.a)
    this.mb.splitMidLP.b.connect(this.mb.compMid)
    this.mb.compMid.connect(this.mb.sum)
    X.wet.connect(this.mb.splitHigh.a)
    this.mb.splitHigh.b.connect(this.mb.compHigh)
    this.mb.compHigh.connect(this.mb.sum)
    this.mb.sum.connect(X.out)
    B.out.connect(X.dry)
    X.dry.connect(X.out)
    X.out.connect(L.wet)
    L.wet.connect(this.comp)
    this.comp.connect(L.out)
    X.out.connect(L.dry)
    L.dry.connect(L.out)
    let node: AudioNode = L.out
    if (this.deHarsh) {
      node.connect(this.deHarsh)
      node = this.deHarsh
    }
    if (this.clipper) {
      node.connect(this.clipper)
      node = this.clipper
    }
    node.connect(this.makeup)
    this.makeup.connect(se.wet)
    se.wet.connect(this.limiter)
    this.limiter.connect(se.out)
    this.makeup.connect(se.dry)
    se.dry.connect(se.out)
    se.out.connect(this.safety)
    kTap(this.safety, afterL, afterR)
    this.safety.connect(afterPeak)
    this.safety.connect(this.wetOut)
    this.wetOut.connect(ctx.destination)
    this.dryOut.connect(ctx.destination)

    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.ready = true
  }

  /** Apply chain params + global bypass with click-free ramps. */
  update(chain: MasteringChain, globalBypass: boolean): void {
    if (!this.ready) return
    const t = this.ctx.currentTime
    this.wetOut.gain.setTargetAtTime(globalBypass ? 0 : 1, t, SMOOTH)
    this.dryOut.gain.setTargetAtTime(globalBypass ? 1 : 0, t, SMOOTH)
    this.hpf.frequency.setTargetAtTime(chain.eq.hpfFreq, t, SMOOTH)
    setBypass(this.hpfBypass, chain.eq.hpfBypassed, t)
    for (let i = 0; i < this.eqBands.length; i++) {
      const node = this.eqBands[i]
      const band = chain.eq.bands[i]
      if (band) {
        if (node.type !== band.type) node.type = band.type
        node.frequency.setTargetAtTime(band.freq, t, SMOOTH)
        node.gain.setTargetAtTime(band.gain, t, SMOOTH)
        node.Q.setTargetAtTime(band.q, t, SMOOTH)
      } else {
        node.gain.setTargetAtTime(0, t, SMOOTH)
      }
    }
    setBypass(this.eqBypass, chain.eq.bypassed, t)
    setComp(this.comp, chain.comp, t)
    setBypass(this.compBypass, chain.comp.bypassed, t)
    setSplitFreq(this.mb.splitLow, chain.mb.crossoverLow, t)
    setSplitFreq(this.mb.splitMidHP, chain.mb.crossoverLow, t)
    setSplitFreq(this.mb.splitMidLP, chain.mb.crossoverHigh, t)
    setSplitFreq(this.mb.splitHigh, chain.mb.crossoverHigh, t)
    setComp(this.mb.compLow, chain.mb.bands[0], t)
    setComp(this.mb.compMid, chain.mb.bands[1], t)
    setComp(this.mb.compHigh, chain.mb.bands[2], t)
    setBypass(this.mbBypass, chain.mb.bypassed, t)
    this.makeup.gain.setTargetAtTime(dbToLin(chain.autoMakeupDb + chain.comp.makeup + chain.userMakeupDb), t, SMOOTH)
    if (this.deHarsh) {
      this.deHarsh.port.postMessage({ bypass: chain.deHarsh.bypassed ? 1 : 0, preset: chain.deHarsh.preset === 'aggressive' ? 1 : 0 })
    }
    if (this.clipper) {
      this.clipper.parameters.get('thresholdDb')?.setTargetAtTime(chain.peakStage.thresholdDb, t, SMOOTH)
      this.clipper.parameters.get('driveDb')?.setTargetAtTime(chain.peakStage.driveDb, t, SMOOTH)
      this.clipper.port.postMessage({ bypass: chain.peakStage.bypassed ? 1 : 0 })
    }
    if (this.limiterIsWorklet) {
      const lim = this.limiter as AudioWorkletNode
      const set = (name: string, v: number) => lim.parameters.get(name)?.setTargetAtTime(v, t, SMOOTH)
      set('ceilingDb', chain.limiter.ceiling)
      set('releaseMs', chain.limiter.release * 1000)
      set('lookaheadMs', chain.limiter.lookaheadMs)
      set('attackMs', chain.limiter.attackMs)
    } else {
      const lim = this.limiter as DynamicsCompressorNode
      lim.threshold.setTargetAtTime(chain.limiter.ceiling, t, SMOOTH)
      lim.release.setTargetAtTime(chain.limiter.release, t, SMOOTH)
    }
    setBypass(this.limiterBypass, chain.limiter.bypassed, t)
  }

  resetMeters(): void {
    this.limiterGrDb = 0
    this.clipperGrDb = 0
    if (this.limiterIsWorklet) (this.limiter as AudioWorkletNode).port.postMessage({ type: 'reset' })
    if (this.clipper) this.clipper.port.postMessage({ type: 'reset' })
    if (this.deHarsh) this.deHarsh.port.postMessage({ type: 'reset' })
  }

  /** Per-stage gain reduction in positive dB. */
  getGainReduction(): { comp: number; limiter: number; clipper: number; mbLow: number; mbMid: number; mbHigh: number } {
    const red = (c: DynamicsCompressorNode) => Math.max(0, -c.reduction)
    const limiter = this.limiterIsWorklet ? Math.max(0, -this.limiterGrDb) : red(this.limiter as DynamicsCompressorNode)
    return {
      comp: red(this.comp),
      limiter,
      clipper: this.clipper ? Math.max(0, -this.clipperGrDb) : 0,
      mbLow: red(this.mb.compLow),
      mbMid: red(this.mb.compMid),
      mbHigh: red(this.mb.compHigh),
    }
  }

  dispose(): void {
    this.ctx.close()
  }
}
