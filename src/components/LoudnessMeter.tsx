import { fmtLufs } from '../lib/format'
import InfoTip from './InfoTip'
import { GUIDE } from '../guide'
import type { MeterReading, MeterSample } from '../audio/meters'

interface Props {
  samples: MeterSample[]
  current: MeterReading
  playing: boolean
}

const W = 1000
const H = 150
const TOP_LUFS = 0
const BOT_LUFS = -50

const y = (lufs: number) => ((TOP_LUFS - lufs) / (TOP_LUFS - BOT_LUFS)) * H

const REF_LINES = [
  { lufs: -8, label: 'KR -8', accent: false },
  { lufs: -14, label: '표준 -14', accent: true },
  { lufs: -23, label: 'EBU -23', accent: false },
  { lufs: -27, label: 'OTT -27', accent: false },
]

function path(samples: MeterSample[], pick: (s: MeterSample) => number): string {
  if (samples.length === 0) return ''
  const latest = samples[samples.length - 1].t
  const start = latest - 30
  let d = ''
  for (const s of samples) {
    const v = pick(s)
    if (!isFinite(v)) continue
    const x = Math.max(0, Math.min(1, (s.t - start) / 30)) * W
    d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y(v).toFixed(1)} `
  }
  return d
}

function Cell({ label, value, unit, active }: { label: string; value: string; unit: string; active?: boolean }) {
  return (
    <div className={`p-2 rounded-md text-center ${active ? 'bg-ink text-paper' : 'bg-mute-1 text-ink'}`}>
      <div className={`text-[10px] uppercase tracking-wider font-medium ${active ? 'text-mute-2' : 'text-mute-3'}`}>{label}</div>
      <div className="text-[18px] font-bold tabular-nums leading-tight">{value}</div>
      <div className={`text-[9px] ${active ? 'text-mute-2' : 'text-mute-3'}`}>{unit}</div>
    </div>
  )
}

export default function LoudnessMeter({ samples, current, playing }: Props) {
  return (
    <div className="border border-mute-2 rounded-xl bg-paper">
      <header className="flex items-center justify-between px-5 py-3 border-b border-mute-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-ink tracking-tight">
            Loudness History
            <InfoTip text={`${GUIDE.loudnessHistory} ${GUIDE.meters}`} label="라우드니스 그래프 설명" />
          </h3>
          <span className="text-[11px] text-mute-3">최근 30초</span>
        </div>
        <span className="text-[11px] text-mute-3">
          {playing ? '측정 중 (라이브 근사 · 정확값은 전체 측정)' : '재생 시 측정 시작'}
        </span>
      </header>

      <div className="px-3 pt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }} preserveAspectRatio="none">
          {[0, -10, -20, -30, -40, -50].map((g) => (
            <g key={g}>
              <line x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="#1a1a1a" strokeWidth={1} />
              <text x={4} y={y(g) + 10} fill="#888" fontSize={9}>
                {g}
              </text>
            </g>
          ))}
          {REF_LINES.map((r) => (
            <g key={r.lufs}>
              <line
                x1={0}
                x2={W}
                y1={y(r.lufs)}
                y2={y(r.lufs)}
                stroke={r.accent ? '#00B899' : '#3a3a3a'}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text x={W - 4} y={y(r.lufs) - 3} fill={r.accent ? '#00B899' : '#888'} fontSize={9} textAnchor="end">
                {r.label}
              </text>
            </g>
          ))}
          <path d={path(samples, (s) => s.shortTerm)} fill="none" stroke="#bbbbbb" strokeWidth={1.5} />
          <path d={path(samples, (s) => s.momentary)} fill="none" stroke="#f5f5f5" strokeWidth={1.5} />
        </svg>
      </div>

      <div className="grid grid-cols-4 gap-2 p-3 border-t border-mute-2">
        <Cell label="M" value={fmtLufs(current.momentary)} unit="LUFS" />
        <Cell label="S" value={fmtLufs(current.shortTerm)} unit="LUFS" />
        <Cell label="I" value={fmtLufs(current.integrated)} unit="LUFS" active />
        <Cell label="True Peak" value={fmtLufs(current.truePeakMax)} unit="dBFS" />
      </div>
    </div>
  )
}
