import InfoTip from '../InfoTip'
import { GUIDE } from '../../guide'
import type { BitDepth } from '../../audio/wav'

interface Props {
  bitDepth: BitDepth
  dither: boolean
  onBitDepth: (d: BitDepth) => void
  onDither: (v: boolean) => void
}

const DEPTHS: BitDepth[] = [16, 24, 32]

export default function OutputFormat({ bitDepth, dither, onBitDepth, onDither }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink tracking-tight">
          출력 포맷
          <InfoTip text={GUIDE.outputFormat} label="출력 포맷 설명" />
        </span>
        <div className="flex gap-2">
          {DEPTHS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onBitDepth(d)}
              className={`px-3 py-1.5 text-[12px] rounded-md transition-colors ${
                bitDepth === d ? 'bg-ink text-paper' : 'border border-mute-2 text-mute-4 hover:border-mute-3'
              }`}
            >
              {d === 32 ? '32-bit float' : `${d}-bit`}
            </button>
          ))}
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[12px] text-mute-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={bitDepth === 32 ? false : dither}
          disabled={bitDepth === 32}
          onChange={(e) => onDither(e.target.checked)}
          className="accent-ink"
        />
        디더 {bitDepth === 32 && <span className="text-mute-3">(float 불필요)</span>}
      </label>
    </div>
  )
}
