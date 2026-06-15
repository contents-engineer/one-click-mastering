import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Player from './Player'
import LoudnessMeter from './LoudnessMeter'
import LimitingFader from './LimitingFader'
import FullMeasure, { type MeasureResult } from './FullMeasure'
import AdvancedPanel, { type ChainEdit } from './advanced/AdvancedPanel'
import QuickGuide from './QuickGuide'
import InfoTip from './InfoTip'
import { GUIDE } from '../guide'
import { buildChain } from '../audio/chain'
import { PRESETS, DEFAULT_PRESET_ID } from '../audio/presets'
import { renderMastered } from '../audio/offlineRender'
import { analyzeLoudness } from '../audio/loudness'
import { encodeWav, downloadBlob, type BitDepth } from '../audio/wav'
import { useMasteringGraph } from '../audio/useMasteringGraph'
import { useMeters } from '../audio/meters'
import { fmtKHz } from '../lib/format'
import type { DecodedTrack, LoudnessAnalysis, MasteringChain } from '../audio/types'

interface Props {
  track: DecodedTrack
  analysis: LoudnessAnalysis
  previewUrl: string
  onReset: () => void
}

const PRESET = PRESETS[DEFAULT_PRESET_ID]

export default function MasteringView({ track, analysis, previewUrl, onReset }: Props) {
  const buildInitial = useCallback(
    () => buildChain(DEFAULT_PRESET_ID, analysis, PRESET.targetLufs, PRESET.ceilingDb, true),
    [analysis],
  )
  const [chain, setChain] = useState<MasteringChain>(buildInitial)
  const initialMakeup = useRef(chain.userMakeupDb)

  const [mode, setMode] = useState<'before' | 'after'>('after')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [bitDepth, setBitDepth] = useState<BitDepth>(24)
  const [dither, setDither] = useState(true)
  const [measure, setMeasure] = useState<MeasureResult | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [showGuide, setShowGuide] = useState(() => {
    try {
      return localStorage.getItem('manex_guide_dismissed') !== '1'
    } catch {
      return true
    }
  })
  const dismissGuide = useCallback(() => {
    setShowGuide(false)
    try {
      localStorage.setItem('manex_guide_dismissed', '1')
    } catch {
      /* ignore */
    }
  }, [])

  const audioRef = useRef<HTMLAudioElement>(null)
  const duration = track.buffer.duration
  const isMono = track.buffer.numberOfChannels === 1

  const { graph, ensureStarted } = useMasteringGraph(audioRef, chain, mode)
  const meters = useMeters(graph, mode, isMono, playing, previewUrl)

  // Loop the selected region during playback.
  useEffect(() => {
    const a = audioRef.current
    if (!a || !selection) return
    if (currentTime >= selection.end || currentTime < selection.start - 0.05) {
      a.currentTime = selection.start
    }
  }, [currentTime, selection])

  const togglePlay = useCallback(async () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      await ensureStarted()
      if (selection) a.currentTime = Math.max(a.currentTime, selection.start)
      await a.play()
    } else {
      a.pause()
    }
  }, [ensureStarted, selection])

  const onSeek = useCallback((t: number) => {
    const a = audioRef.current
    if (a) a.currentTime = t
  }, [])

  // ---- chain editing ----
  const edit: ChainEdit = useMemo(
    () => ({
      eqBand: (i, p) => setChain((c) => ({ ...c, eq: { ...c.eq, bands: c.eq.bands.map((b, j) => (j === i ? { ...b, ...p } : b)) } })),
      eqToggle: (b) => setChain((c) => ({ ...c, eq: { ...c.eq, bypassed: b } })),
      eqFlatten: () => setChain((c) => ({ ...c, eq: { ...c.eq, bands: c.eq.bands.map((b) => ({ ...b, gain: 0 })) } })),
      comp: (p) => setChain((c) => ({ ...c, comp: { ...c.comp, ...p } })),
      compToggle: (b) => setChain((c) => ({ ...c, comp: { ...c.comp, bypassed: b } })),
      mbBand: (i, p) => setChain((c) => ({ ...c, mb: { ...c.mb, bands: c.mb.bands.map((bd, j) => (j === i ? { ...bd, ...p } : bd)) } })),
      mbToggle: (b) => setChain((c) => ({ ...c, mb: { ...c.mb, bypassed: b } })),
      limiter: (p) => setChain((c) => ({ ...c, limiter: { ...c.limiter, ...p } })),
      limiterToggle: (b) => setChain((c) => ({ ...c, limiter: { ...c.limiter, bypassed: b } })),
      peakDrive: (db) => setChain((c) => ({ ...c, peakStage: { ...c.peakStage, driveDb: db, bypassed: db > 0 ? false : c.peakStage.bypassed } })),
      peakToggle: (b) => setChain((c) => ({ ...c, peakStage: { ...c.peakStage, bypassed: b } })),
    }),
    [],
  )

  const setUserMakeup = useCallback((db: number) => setChain((c) => ({ ...c, userMakeupDb: db })), [])
  const resetUserMakeup = useCallback(() => setChain((c) => ({ ...c, userMakeupDb: initialMakeup.current })), [])
  const onAutoReset = useCallback(() => setChain(buildInitial()), [buildInitial])

  // ---- full measure + download (offline render) ----
  const onMeasure = useCallback(async () => {
    setMeasuring(true)
    try {
      const rendered = await renderMastered(track.buffer, chain)
      const after = await analyzeLoudness(rendered)
      setMeasure({
        before: { lufsI: analysis.lufsI, truePeakDb: analysis.truePeakDb },
        after: { lufsI: after.lufsI, truePeakDb: after.truePeakDb },
        time: new Date().toLocaleTimeString('ko-KR'),
      })
    } finally {
      setMeasuring(false)
    }
  }, [track.buffer, chain, analysis])

  const onDownload = useCallback(async () => {
    setRendering(true)
    try {
      const rendered = await renderMastered(track.buffer, chain)
      const blob = encodeWav(rendered, { bitDepth, dither })
      const base = track.fileName.replace(/\.[^.]+$/, '')
      const depthTag = bitDepth === 32 ? '32f' : `${bitDepth}bit`
      downloadBlob(blob, `${base}_mastered_${PRESET.label}_${depthTag}.wav`)
    } finally {
      setRendering(false)
    }
  }, [track.buffer, track.fileName, chain, bitDepth, dither])

  const afterLufs = measure
    ? measure.after.lufsI
    : mode === 'after' && isFinite(meters.current.integrated)
      ? meters.current.integrated
      : null

  return (
    <div className="space-y-5">
      <audio
        ref={audioRef}
        src={previewUrl}
        preload="auto"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />

      {showGuide && <QuickGuide onClose={dismissGuide} />}

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] text-ink font-medium truncate">{track.fileName}</p>
          <p className="text-[12px] text-mute-4 mt-0.5 flex items-center gap-1 flex-wrap">
            <span>
              {duration.toFixed(1)}s · {isMono ? 'Mono' : 'Stereo'} · {fmtKHz(track.buffer.sampleRate)}kHz
              {isFinite(analysis.lufsI) ? ` · 원본 ${analysis.lufsI.toFixed(1)} LUFS` : ''}
            </span>
            {isFinite(analysis.lufsI) && <InfoTip text={GUIDE.lufs} label="LUFS 음량 설명" />}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-mute-4">
          <span className="flex items-center gap-1 font-semibold text-ink tabular-nums">
            AI음악 자동 · 상한 {PRESET.targetLufs} LUFS
            <InfoTip text={GUIDE.targetCeiling} label="목표 음량 설명" />
          </span>
          {!showGuide && (
            <button
              type="button"
              onClick={() => setShowGuide(true)}
              className="text-[12px] text-mute-3 hover:text-ink underline underline-offset-4"
            >
              ❓ 사용법
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="ml-2 text-[12px] text-mute-3 hover:text-ink underline underline-offset-4"
          >
            다른 파일
          </button>
        </div>
      </div>

      <div className="space-y-5">
        <Player
          buffer={track.buffer}
          fileName={track.fileName}
          mode={mode}
          onToggleMode={setMode}
          beforeLufs={analysis.lufsI}
          afterLufs={afterLufs}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          selection={selection}
          onPlayPause={togglePlay}
          onSeek={onSeek}
          onSelect={setSelection}
        />

        <LoudnessMeter samples={meters.samples} current={meters.current} playing={playing} />

        <LimitingFader
          userMakeupDb={chain.userMakeupDb}
          onChangeDb={setUserMakeup}
          onResetDb={resetUserMakeup}
          grDb={meters.gr.limiter}
          outPeakDb={playing ? meters.current.peak : -Infinity}
          playing={playing}
        />

        <FullMeasure result={measure} measuring={measuring} targetLufs={PRESET.targetLufs} onMeasure={onMeasure} />

        <AdvancedPanel
          chain={chain}
          clipperGr={meters.gr.clipper}
          bitDepth={bitDepth}
          dither={dither}
          onBitDepth={setBitDepth}
          onDither={setDither}
          onAutoReset={onAutoReset}
          edit={edit}
        />

        <button
          type="button"
          onClick={onDownload}
          disabled={rendering}
          className="w-full py-4 bg-ink text-paper rounded-lg text-[15px] font-semibold hover:bg-mute-4 transition-colors disabled:opacity-50"
        >
          {rendering ? '렌더링 중…' : '현재 설정으로 WAV 다운로드'}
        </button>
      </div>
    </div>
  )
}
