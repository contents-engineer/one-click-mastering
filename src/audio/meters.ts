/**
 * Live loudness/peak meters (ported from `nf`/`Fm`). Reads K-weighted analyser
 * taps every 100 ms, computing momentary / short-term (3 s) / integrated (gated)
 * LUFS, instantaneous + max peak, plus per-stage gain reduction.
 */
import { useEffect, useRef, useState } from 'react'
import { blockLufs } from './loudness'
import type { MasteringGraph } from './realtimeGraph'

const TICK_MS = 100
const HISTORY = Math.floor((30 * 1000) / TICK_MS) // 300 samples = 30 s

export interface MeterReading {
  momentary: number
  shortTerm: number
  integrated: number
  peak: number
  truePeakMax: number
}

export interface MeterSample {
  t: number
  momentary: number
  shortTerm: number
  integrated: number
  peak: number
}

export interface GainReduction {
  comp: number
  limiter: number
  clipper: number
  mbLow: number
  mbMid: number
  mbHigh: number
}

const EMPTY_READING: MeterReading = { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, peak: -Infinity, truePeakMax: -Infinity }
const EMPTY_GR: GainReduction = { comp: 0, limiter: 0, clipper: 0, mbLow: 0, mbMid: 0, mbHigh: 0 }

function readMsPeak(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): { ms: number; peak: number } {
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  let peak = 0
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    sum += v * v
    const a = v < 0 ? -v : v
    if (a > peak) peak = a
  }
  return { ms: sum / buf.length, peak }
}

function readPeak(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf)
  let peak = 0
  for (let i = 0; i < buf.length; i++) {
    const a = buf[i] < 0 ? -buf[i] : buf[i]
    if (a > peak) peak = a
  }
  return peak
}

/** Per-tap rolling accumulator (one for Before, one for After). */
class LoudnessAccumulator {
  shortBuf: number[] = []
  intBlocks: number[] = []
  peakMax = 0
  samples: MeterSample[] = []

  push(ms: number, peakLin: number, t: number): MeterReading {
    const momentary = blockLufs(ms)
    this.shortBuf.push(ms)
    while (this.shortBuf.length > 30) this.shortBuf.shift()
    const shortMean = this.shortBuf.reduce((a, b) => a + b, 0) / this.shortBuf.length
    const shortTerm = blockLufs(shortMean)

    if (momentary >= -70 && isFinite(momentary)) this.intBlocks.push(ms)
    let integrated = -Infinity
    if (this.intBlocks.length > 0) {
      const meanAll = this.intBlocks.reduce((a, b) => a + b, 0) / this.intBlocks.length
      const relThresh = blockLufs(meanAll) - 10
      const gated = this.intBlocks.filter((n) => blockLufs(n) >= relThresh)
      const gatedMean = gated.length > 0 ? gated.reduce((a, b) => a + b, 0) / gated.length : meanAll
      integrated = blockLufs(gatedMean)
    }

    if (peakLin > this.peakMax) this.peakMax = peakLin
    const peak = peakLin > 0 ? 20 * Math.log10(peakLin) : -Infinity
    const truePeakMax = this.peakMax > 0 ? 20 * Math.log10(this.peakMax) : -Infinity

    this.samples.push({ t, momentary, shortTerm, integrated, peak })
    while (this.samples.length > HISTORY) this.samples.shift()
    return { momentary, shortTerm, integrated, peak, truePeakMax }
  }
}

export interface MetersState {
  samples: MeterSample[]
  current: MeterReading
  gr: GainReduction
}

/** Drive the live meters from the realtime graph for the active A/B mode. */
export function useMeters(
  graph: MasteringGraph | null,
  mode: 'before' | 'after',
  isMono: boolean,
  enabled: boolean,
  resetKey: unknown,
): MetersState {
  const [state, setState] = useState<MetersState>({ samples: [], current: EMPTY_READING, gr: EMPTY_GR })
  const beforeAcc = useRef(new LoudnessAccumulator())
  const afterAcc = useRef(new LoudnessAccumulator())
  const raf = useRef<number | null>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode

  // Reset accumulators when the track changes.
  useEffect(() => {
    beforeAcc.current = new LoudnessAccumulator()
    afterAcc.current = new LoudnessAccumulator()
    setState({ samples: [], current: EMPTY_READING, gr: EMPTY_GR })
  }, [resetKey])

  // When the A/B mode flips, surface the other accumulator's history immediately.
  useEffect(() => {
    const acc = mode === 'before' ? beforeAcc.current : afterAcc.current
    setState((s) => ({ ...s, samples: [...acc.samples] }))
  }, [mode])

  useEffect(() => {
    const a = graph?.analysers
    if (!enabled || !a) {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      raf.current = null
      return
    }
    const beforeLBuf = new Float32Array(a.beforeL.fftSize)
    const beforeRBuf = new Float32Array(a.beforeR.fftSize)
    const afterLBuf = new Float32Array(a.afterL.fftSize)
    const afterRBuf = new Float32Array(a.afterR.fftSize)
    const beforePeakBuf = new Float32Array(a.beforePeak.fftSize)
    const afterPeakBuf = new Float32Array(a.afterPeak.fftSize)
    let last = -Infinity

    const sum = (l: number, r: number) => (isMono ? l : l + r)

    const loop = (nowMs: number) => {
      if (nowMs - last >= TICK_MS) {
        last = nowMs
        const t = nowMs / 1000
        const beforeMs = sum(readMsPeak(a.beforeL, beforeLBuf).ms, readMsPeak(a.beforeR, beforeRBuf).ms)
        const afterL = readMsPeak(a.afterL, afterLBuf)
        const afterR = readMsPeak(a.afterR, afterRBuf)
        const afterMs = sum(afterL.ms, afterR.ms)
        const beforePeak = readPeak(a.beforePeak, beforePeakBuf)
        const afterPeak = readPeak(a.afterPeak, afterPeakBuf)
        const beforeReading = beforeAcc.current.push(beforeMs, beforePeak, t)
        const afterReading = afterAcc.current.push(afterMs, afterPeak, t)
        const acc = modeRef.current === 'before' ? beforeAcc.current : afterAcc.current
        const reading = modeRef.current === 'before' ? beforeReading : afterReading
        setState({ samples: [...acc.samples], current: reading, gr: graph!.getGainReduction() })
      }
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      raf.current = null
    }
  }, [graph, enabled, isMono])

  return state
}
