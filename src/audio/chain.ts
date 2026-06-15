/**
 * Mastering chain builder (`bi`) + auto makeup-gain math (`mm`/`vm`/`ym`) +
 * mode classifier (`im`) + EQ band builder (`xm`). Ported verbatim.
 */
import { PRESETS } from './presets'
import type { EqBand, LoudnessAnalysis, MasteringChain, PresetId } from './types'
import type { ToneEq } from './presets'

// --- constants ---
const HEADROOM_PAD = 0.5 // pm
export const MAX_MAKEUP_DB = 18 // $c
export const CLIPPER_THRESHOLD_DB = -3 // Uc

// Multiband defaults: timing/knee when a preset supplies its own mb thresholds.
const MB_TIMING = [
  { attack: 0.02, release: 0.2, knee: 6 },
  { attack: 0.015, release: 0.15, knee: 6 },
  { attack: 0.005, release: 0.08, knee: 6 },
]
// Full multiband defaults when the preset has no `mb` block.
const MB_DEFAULTS = [
  { threshold: -22, ratio: 2, attack: 0.02, release: 0.2, knee: 6 },
  { threshold: -20, ratio: 2, attack: 0.015, release: 0.15, knee: 6 },
  { threshold: -22, ratio: 2.5, attack: 0.005, release: 0.08, knee: 6 },
]
// EQ band center frequencies (6 bands: lowshelf / 4× peaking / highshelf).
const EQ_CENTERS = [60, 150, 400, 1000, 3000, 8000]

// Mode classifier thresholds.
const CREST_HI = 11 // lm
const TRANSIENT_MID = 0.4 // om
const TRANSIENT_HI = 0.6 // sm

export interface ModeResult {
  mode: 'clipper' | 'transient'
  reason: string
}

/** Recommend clipper vs transient handling from crest + transient density. */
export function classifyMode(a: { crestDb: number; transientDensity: number }): ModeResult {
  if ((a.crestDb >= CREST_HI && a.transientDensity >= TRANSIENT_MID) || a.transientDensity >= TRANSIENT_HI) {
    return {
      mode: 'clipper',
      reason: `크레스트 ${a.crestDb.toFixed(1)}dB·트랜지언트 많음 → 클리퍼로 피크를 깎아 음압 확보 권장`,
    }
  }
  return {
    mode: 'transient',
    reason: `크레스트 ${a.crestDb.toFixed(1)}dB·지속음 위주 → 가볍게(드라이브 낮게), 색 최소화 권장`,
  }
}

/** Build 6 EQ bands and fold the preset's low/mid/high shelving onto nearest band. */
export function buildEqBands(tone: ToneEq): EqBand[] {
  const bands: EqBand[] = EQ_CENTERS.map((freq, i) => ({
    type: i === 0 ? 'lowshelf' : i === EQ_CENTERS.length - 1 ? 'highshelf' : 'peaking',
    freq,
    gain: 0,
    q: 0.7,
  }))
  const nearest = (freq: number): number => {
    let best = 0
    let bestDist = Infinity
    EQ_CENTERS.forEach((center, i) => {
      const d = Math.abs(Math.log2(center / freq))
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    return best
  }
  bands[nearest(tone.low.freq)].gain += tone.low.gain
  bands[nearest(tone.mid.freq)].gain += tone.mid.gain
  bands[nearest(tone.high.freq)].gain += tone.high.gain
  return bands
}

/**
 * Auto makeup gain (`mm`).
 *  - 'target'   : normalize TO the LUFS target (the deficit), attenuating
 *                 already-loud sources too; the true-peak limiter guards the
 *                 ceiling. This is the default — it lands the master ON the
 *                 preset target (−14 LUFS for streaming) rather than pushing it
 *                 toward the peak ceiling.
 *  - 'headroom' : legacy loudness-maximizer that fills the available peak
 *                 headroom (kept for reference; no longer the default).
 */
function autoMakeup(
  lufsI: number,
  truePeakDb: number,
  targetLufs: number,
  ceilingDb: number,
  clipperDrive: number,
  mode: 'headroom' | 'target' = 'target',
): number {
  if (!isFinite(lufsI)) return 0
  const deficit = targetLufs - lufsI
  if (mode === 'target') return Math.max(-MAX_MAKEUP_DB, Math.min(MAX_MAKEUP_DB, deficit))
  const tp = isFinite(truePeakDb) ? truePeakDb : 0
  const headroom = ceilingDb - tp + clipperDrive + HEADROOM_PAD
  return Math.max(0, Math.min(MAX_MAKEUP_DB, Math.min(deficit, headroom)))
}

/** clipper drive (`ym`). */
function clipperDriveGain(truePeakDb: number, threshold: number, baseDrive: number): number {
  const tp = isFinite(truePeakDb) ? truePeakDb : 0
  const over = Math.max(0, tp + baseDrive - threshold)
  return Math.max(0, Math.min(6, Math.min(baseDrive + over, over + 2)))
}

/** Build the full mastering chain (`bi`). */
export function buildChain(
  presetId: PresetId,
  analysis: LoudnessAnalysis | null,
  targetLufs: number,
  ceilingDb: number,
  isSuno = false,
): MasteringChain {
  const tone = PRESETS[presetId].tone
  const recommended = analysis
    ? classifyMode({ crestDb: analysis.crestDb, transientDensity: analysis.transientDensity })
    : null
  const clipperMode = !!analysis && recommended?.mode === 'clipper'
  const driveScale = isSuno ? 0.2 : 0.4
  const baseDrive = clipperMode
    ? Math.max(0, Math.min(isSuno ? 1 : 2, (analysis!.crestDb - 12) * driveScale))
    : 0
  const drive = clipperMode ? clipperDriveGain(analysis!.truePeakDb, CLIPPER_THRESHOLD_DB, baseDrive) : 0
  const auto = analysis
    ? autoMakeup(analysis.lufsI, analysis.truePeakDb, targetLufs, ceilingDb, drive, 'target')
    : 0
  const autoClamped = Math.max(-18, Math.min(18, auto))

  return {
    eq: {
      bypassed: !tone.eqOn,
      hpfFreq: tone.hpf.freq,
      hpfBypassed: !tone.hpf.on,
      bands: buildEqBands(tone),
    },
    comp: {
      bypassed: !tone.compOn,
      threshold: tone.comp.threshold,
      ratio: tone.comp.ratio,
      attack: tone.comp.attack,
      release: tone.comp.release,
      knee: tone.comp.knee,
      makeup: 0,
    },
    mb: {
      bypassed: !tone.mbOn,
      crossoverLow: 200,
      crossoverHigh: 2000,
      bands: tone.mb
        ? [
            { ...MB_TIMING[0], threshold: tone.mb.low.threshold, ratio: tone.mb.low.ratio },
            { ...MB_TIMING[1], threshold: tone.mb.mid.threshold, ratio: tone.mb.mid.ratio },
            { ...MB_TIMING[2], threshold: tone.mb.high.threshold, ratio: tone.mb.high.ratio },
          ]
        : [{ ...MB_DEFAULTS[0] }, { ...MB_DEFAULTS[1] }, { ...MB_DEFAULTS[2] }],
    },
    deHarsh: { bypassed: true, preset: 'gentle' },
    peakStage: {
      bypassed: !clipperMode,
      mode: 'clipper',
      thresholdDb: CLIPPER_THRESHOLD_DB,
      driveDb: drive,
      autoRecommended: !!clipperMode,
    },
    autoMakeupDb: autoClamped,
    // Loudness "드라이브" fader starts neutral (0 dB): the auto makeup above
    // already lands the master on the target LUFS. Pushing the fader up makes it
    // louder than the streaming standard. (Previously this was auto-filled to the
    // peak ceiling → ~+2.6 dB overshoot, i.e. ≈ −9 LUFS instead of −14.)
    userMakeupDb: 0,
    limiter: { bypassed: false, ceiling: ceilingDb, release: 0.05, lookaheadMs: 1.5, attackMs: 1 },
    normalizeMode: 'target',
  }
}
