import Waveform from './Waveform'
import InfoTip from './InfoTip'
import { GUIDE } from '../guide'
import { fmtClock, fmtLufs } from '../lib/format'

interface Props {
  buffer: AudioBuffer
  fileName: string
  mode: 'before' | 'after'
  onToggleMode: (mode: 'before' | 'after') => void
  beforeLufs: number
  afterLufs: number | null
  playing: boolean
  currentTime: number
  duration: number
  selection: { start: number; end: number } | null
  onPlayPause: () => void
  onSeek: (t: number) => void
  onSelect: (sel: { start: number; end: number } | null) => void
}

export default function Player(props: Props) {
  const { mode, onToggleMode, beforeLufs, afterLufs, playing, currentTime, duration, fileName, buffer, selection } = props

  const abButton = (which: 'before' | 'after') => {
    const active = mode === which
    const isBefore = which === 'before'
    const lufs = isBefore ? `${fmtLufs(beforeLufs)} LUFS` : afterLufs == null ? '측정 전' : `${fmtLufs(afterLufs)} LUFS`
    return (
      <button
        type="button"
        onClick={() => onToggleMode(which)}
        className={`flex-1 py-3 rounded-lg text-left px-4 transition-all ${
          active ? 'bg-ink text-paper' : 'bg-paper text-mute-4 border border-mute-2'
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium">{isBefore ? 'Before' : 'After'}</span>
          <span className="text-[13px] tabular-nums font-semibold">{lufs}</span>
        </div>
        <div className="text-[10px] opacity-70 mt-0.5">{isBefore ? '원본' : '마스터링 적용'}</div>
      </button>
    )
  }

  return (
    <div className="border border-mute-2 rounded-xl p-5 bg-paper space-y-4">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-mute-3">Before / After 비교</span>
        <InfoTip text={GUIDE.beforeAfter} label="Before/After 설명" />
      </div>
      <div className="flex gap-2">
        {abButton('before')}
        {abButton('after')}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-mute-4">
            {fileName} · {duration.toFixed(1)}s
          </span>
          <span className="text-[11px] text-mute-3 tabular-nums">
            {fmtClock(currentTime)} / {fmtClock(duration)}
          </span>
        </div>
        <Waveform
          buffer={buffer}
          currentTime={currentTime}
          duration={duration}
          selection={selection}
          onSeek={props.onSeek}
          onSelect={props.onSelect}
        />
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={props.onPlayPause}
          className="w-14 h-14 rounded-full bg-ink text-paper flex items-center justify-center text-xl hover:bg-mute-4 transition-colors"
          aria-label={playing ? '일시정지' : '재생'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        {selection && (
          <button
            type="button"
            onClick={() => props.onSelect(null)}
            className="px-3 py-1.5 text-[12px] text-mute-3 hover:text-ink border border-mute-2 rounded-lg transition-colors"
          >
            선택 해제
          </button>
        )}
      </div>

      <p className="text-[11px] text-mute-3 text-center">
        파형 클릭 → 그 위치 재생 · 드래그 → 구간 반복 · 더블클릭 → 선택 해제
      </p>
    </div>
  )
}
