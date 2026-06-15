import { useRef } from 'react'
import ModuleHeader from './ModuleHeader'
import { GUIDE } from '../../guide'
import type { EqBand } from '../../audio/types'

interface Props {
  bands: EqBand[]
  bypassed: boolean
  onChangeBand: (index: number, partial: Partial<EqBand>) => void
  onToggle: (bypassed: boolean) => void
  onFlatten: () => void
}

const W = 1000
const H = 200
const GAIN_MAX = 12
const F_MIN = 20
const F_MAX = 20000
const LOG_SPAN = Math.log2(F_MAX / F_MIN)

const freqToX = (f: number) => (Math.log2(f / F_MIN) / LOG_SPAN) * W
const xToFreq = (x: number) => F_MIN * Math.pow(2, (x / W) * LOG_SPAN)
const gainToY = (g: number) => (H / 2) * (1 - g / GAIN_MAX)
const yToGain = (y: number) => 12 - (24 * y) / H

const GRID_FREQS = [
  { f: 100, label: '100' },
  { f: 1000, label: '1k' },
  { f: 10000, label: '10k' },
]

export default function EqGraph({ bands, bypassed, onChangeBand, onToggle, onFlatten }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragIndex = useRef<number | null>(null)

  const handleMove = (e: React.PointerEvent) => {
    const i = dragIndex.current
    if (i === null) return
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const y = ((e.clientY - rect.top) / rect.height) * H
    const gain = Math.max(-GAIN_MAX, Math.min(GAIN_MAX, yToGain(y)))
    const lower = i > 0 ? bands[i - 1].freq * 1.05 : F_MIN
    const upper = i < bands.length - 1 ? bands[i + 1].freq * 0.95 : F_MAX
    const freq = Math.max(lower, Math.min(upper, xToFreq(x)))
    onChangeBand(i, { gain, freq })
  }

  const curve = bands.map((b) => `${freqToX(b.freq).toFixed(1)},${gainToY(b.gain).toFixed(1)}`).join(' ')

  return (
    <div className="border border-mute-2 rounded-xl p-4 bg-paper">
      <ModuleHeader title="EQ" tip={GUIDE.eq} bypassed={bypassed} onToggle={onToggle} />
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-mute-3">점을 끌어 주파수·게인 조정 · 더블클릭=0dB · 재생 시 실시간 주파수 표시</span>
        <button type="button" onClick={onFlatten} className="text-[11px] text-mute-3 hover:text-ink underline underline-offset-4">
          평탄화
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-md bg-mute-1 touch-none"
        style={{ height: 200 }}
        preserveAspectRatio="none"
        onPointerMove={handleMove}
        onPointerUp={() => (dragIndex.current = null)}
        onPointerLeave={() => (dragIndex.current = null)}
      >
        {/* gain gridlines */}
        {[-12, -6, 0, 6, 12].map((g) => (
          <g key={g}>
            <line x1={0} x2={W} y1={gainToY(g)} y2={gainToY(g)} stroke={g === 0 ? '#3a3a3a' : '#222'} strokeWidth={1} />
            <text x={4} y={gainToY(g) - 3} fill="#888" fontSize={9}>
              {g > 0 ? `+${g}` : g}
            </text>
          </g>
        ))}
        {/* freq gridlines */}
        {GRID_FREQS.map((gf) => (
          <g key={gf.f}>
            <line x1={freqToX(gf.f)} x2={freqToX(gf.f)} y1={0} y2={H} stroke="#222" strokeWidth={1} />
            <text x={freqToX(gf.f) + 3} y={H - 4} fill="#888" fontSize={9}>
              {gf.label}
            </text>
          </g>
        ))}
        {/* response polyline */}
        <polyline points={curve} fill="none" stroke={bypassed ? '#3a3a3a' : '#00B899'} strokeWidth={2} opacity={bypassed ? 0.5 : 1} />
        {/* draggable nodes */}
        {bands.map((b, i) => (
          <circle
            key={i}
            cx={freqToX(b.freq)}
            cy={gainToY(b.gain)}
            r={7}
            fill="#f5f5f5"
            stroke="#0a0a0a"
            strokeWidth={2}
            className="cursor-grab"
            onPointerDown={(e) => {
              ;(e.target as SVGElement).setPointerCapture(e.pointerId)
              dragIndex.current = i
            }}
            onDoubleClick={() => onChangeBand(i, { gain: 0 })}
          >
            <title>{`밴드 ${i + 1} · ${Math.round(b.freq)}Hz · ${b.gain > 0 ? '+' : ''}${b.gain.toFixed(1)}dB`}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}
