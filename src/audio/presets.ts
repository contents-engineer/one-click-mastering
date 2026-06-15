// Distribution-target presets (the original `Wi` map). The live mastering flow
// pins every track to `streaming` (−14 LUFS). The others are kept for fidelity /
// future use but are not surfaced in the UI (there is no genre selector).
import type { PresetId } from './types'

export interface ToneEq {
  hpf: { on: boolean; freq: number }
  eqOn: boolean
  low: { freq: number; gain: number }
  mid: { freq: number; gain: number; q: number }
  high: { freq: number; gain: number }
  compOn: boolean
  comp: { threshold: number; ratio: number; attack: number; release: number; knee: number }
  mbOn: boolean
  mb?: {
    low: { threshold: number; ratio: number }
    mid: { threshold: number; ratio: number }
    high: { threshold: number; ratio: number }
  }
}

export interface Preset {
  id: PresetId
  label: string
  description: string
  targetLufs: number
  ceilingDb: number
  source: string
  certain: boolean
  tone: ToneEq
}

export const PRESETS: Record<PresetId, Preset> = {
  korean: {
    id: 'korean',
    label: '국내 (멜론·지니·벅스)',
    description: 'K-pop 산업 관행 −8 LUFS 라우드 마스터',
    targetLufs: -8,
    ceilingDb: -1,
    source: '공식 표준 없음 · 멜론/지니/벅스 미공개 · 산업 관행 추정',
    certain: false,
    tone: {
      hpf: { on: true, freq: 30 },
      eqOn: true,
      low: { freq: 90, gain: 1 },
      mid: { freq: 3000, gain: -0.5, q: 0.9 },
      high: { freq: 12000, gain: 2 },
      compOn: true,
      comp: { threshold: -16, ratio: 2, attack: 0.02, release: 0.18, knee: 6 },
      mbOn: true,
      mb: {
        low: { threshold: -20, ratio: 1.8 },
        mid: { threshold: -22, ratio: 1.5 },
        high: { threshold: -24, ratio: 1.6 },
      },
    },
  },
  streaming: {
    id: 'streaming',
    label: '스트리밍 표준',
    description: 'Spotify · YouTube · Tidal · Amazon 공통 −14 LUFS',
    targetLufs: -14,
    ceilingDb: -1,
    source: 'Spotify, YouTube, Tidal, Amazon 공식',
    certain: true,
    tone: {
      hpf: { on: true, freq: 25 },
      eqOn: true,
      low: { freq: 100, gain: 0 },
      mid: { freq: 1000, gain: 0, q: 1 },
      high: { freq: 12000, gain: 0.5 },
      compOn: true,
      comp: { threshold: -18, ratio: 1.5, attack: 0.03, release: 0.25, knee: 6 },
      mbOn: false,
    },
  },
  apple: {
    id: 'apple',
    label: 'Apple Music',
    description: 'Sound Check 기준 −16 LUFS',
    targetLufs: -16,
    ceilingDb: -1,
    source: 'Apple Music 공식',
    certain: true,
    tone: {
      hpf: { on: true, freq: 25 },
      eqOn: true,
      low: { freq: 110, gain: 0.8 },
      mid: { freq: 2500, gain: -0.5, q: 0.9 },
      high: { freq: 11000, gain: 0.5 },
      compOn: true,
      comp: { threshold: -18, ratio: 1.5, attack: 0.04, release: 0.3, knee: 6 },
      mbOn: false,
    },
  },
  broadcast: {
    id: 'broadcast',
    label: '방송 EBU R128',
    description: 'BBC·영국·유럽 방송 표준 −23 LUFS',
    targetLufs: -23,
    ceilingDb: -1,
    source: 'EBU R128 v5.0 (2023.11)',
    certain: true,
    tone: {
      hpf: { on: true, freq: 35 },
      eqOn: true,
      low: { freq: 100, gain: 0 },
      mid: { freq: 1000, gain: 0, q: 1 },
      high: { freq: 12000, gain: 0 },
      compOn: true,
      comp: { threshold: -20, ratio: 1.5, attack: 0.05, release: 0.3, knee: 8 },
      mbOn: false,
    },
  },
  ott: {
    id: 'ott',
    label: 'OTT 영상',
    description: 'Netflix · Disney+ · Prime · Max −27 LKFS',
    targetLufs: -27,
    ceilingDb: -2,
    source: 'OTT 대사 게이팅 표준 (음악과 측정 방식 다름)',
    certain: true,
    tone: {
      hpf: { on: true, freq: 35 },
      eqOn: false,
      low: { freq: 100, gain: 0 },
      mid: { freq: 1000, gain: 0, q: 1 },
      high: { freq: 12000, gain: 0 },
      compOn: false,
      comp: { threshold: -20, ratio: 1.5, attack: 0.05, release: 0.3, knee: 6 },
      mbOn: false,
    },
  },
}

/** The preset the mastering flow pins every track to. */
export const DEFAULT_PRESET_ID: PresetId = 'streaming'
