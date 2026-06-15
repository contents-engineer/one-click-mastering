// Shared audio types for the Manex mastering engine.

export type PresetId = 'korean' | 'streaming' | 'apple' | 'broadcast' | 'ott'

export interface EqBand {
  type: BiquadFilterType
  freq: number
  gain: number
  q: number
}

export interface MultibandBand {
  threshold: number
  ratio: number
  attack: number
  release: number
  knee: number
}

export type DeHarshPreset = 'gentle' | 'aggressive'

/** Full mastering chain — the single parameter object shared by the realtime
 *  graph and the offline render (mirrors the original `bi()` output). */
export interface MasteringChain {
  eq: {
    bypassed: boolean
    hpfFreq: number
    hpfBypassed: boolean
    bands: EqBand[]
  }
  comp: {
    bypassed: boolean
    threshold: number
    ratio: number
    attack: number
    release: number
    knee: number
    makeup: number
  }
  mb: {
    bypassed: boolean
    crossoverLow: number
    crossoverHigh: number
    bands: MultibandBand[]
  }
  deHarsh: {
    bypassed: boolean
    preset: DeHarshPreset
  }
  peakStage: {
    bypassed: boolean
    mode: 'clipper'
    thresholdDb: number
    driveDb: number
    autoRecommended: boolean
  }
  autoMakeupDb: number
  userMakeupDb: number
  limiter: {
    bypassed: boolean
    ceiling: number
    release: number
    lookaheadMs: number
    attackMs: number
  }
  normalizeMode: 'headroom' | 'target'
}

/** Loudness analysis result (mirrors the original `Oi()` output). */
export interface LoudnessAnalysis {
  lufsI: number
  peakDb: number
  truePeakDb: number
  crestDb: number
  transientDensity: number
}

export interface DecodedTrack {
  buffer: AudioBuffer
  fileName: string
  fileSize: number
}
