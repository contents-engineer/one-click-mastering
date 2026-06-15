import { fmtDb } from '../lib/format'
import InfoTip from './InfoTip'
import { GUIDE } from '../guide'

interface Props {
  userMakeupDb: number
  onChangeDb: (db: number) => void
  onResetDb: () => void
  grDb: number
  outPeakDb: number
  playing: boolean
}

const MIN_DB = -12
const MAX_DB = 12

const dbToPct = (db: number) => Math.round(((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100)
const pctToDb = (pct: number) => MIN_DB + (pct / 100) * (MAX_DB - MIN_DB)

export default function LimitingFader({ userMakeupDb, onChangeDb, onResetDb, grDb, outPeakDb, playing }: Props) {
  const pct = dbToPct(userMakeupDb)

  let status = '재생하면 출력 레벨이 표시됩니다'
  let statusColor = 'text-mute-3'
  if (playing) {
    if (outPeakDb > 0) {
      status = '⚠ 클립! 드라이브를 낮추세요'
      statusColor = 'text-[#d14343]'
    } else if (grDb > 6) {
      status = '⚠ 리미팅 과도 — 드라이브를 낮추세요'
      statusColor = 'text-[#d14343]'
    } else if (outPeakDb >= -3) {
      status = '피크 임박 (−3dBFS 이상)'
      statusColor = 'text-[#e0a23a]'
    } else {
      status = '양호'
      statusColor = 'text-accent'
    }
  }

  return (
    <section className="px-1">
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="flex items-baseline gap-1.5">
          <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-ink tracking-tight">
            리미팅
            <InfoTip text={GUIDE.limiting} label="리미팅 설명" />
          </h3>
          <span className="text-[11px] text-mute-3">올리면 더 크게 · 깨지면 낮추세요</span>
        </div>
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-[20px] font-bold text-ink leading-none">{pct}%</span>
          <span className="text-[11px] text-mute-4">{fmtDb(userMakeupDb)}dB</span>
        </div>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-[13px] font-semibold ${statusColor}`}>{status}</span>
        <span className="flex items-center gap-1 text-[11px] tabular-nums text-mute-3">
          <InfoTip text={GUIDE.gr} label="GR 설명" />
          GR {grDb.toFixed(1)}dB
        </span>
      </div>
      <div className="flex items-stretch justify-center gap-6 py-2">
        <div className="flex flex-col items-center gap-1.5">
          <input
            type="range"
            aria-label="리미팅 드라이브"
            className="fader-vert"
            min={0}
            max={100}
            step={1}
            value={pct}
            onChange={(e) => onChangeDb(pctToDb(Number(e.target.value)))}
            onDoubleClick={onResetDb}
            style={{ accentColor: '#f5f5f5' }}
          />
          <span className="text-[9px] uppercase tracking-wider text-mute-3">드라이브</span>
        </div>
        <div className="flex flex-col items-center justify-end gap-1.5 pb-5">
          <span className="text-[9px] tabular-nums text-mute-3">{isFinite(outPeakDb) ? outPeakDb.toFixed(1) : '—'}</span>
          <span className="text-[8px] uppercase tracking-wider text-mute-3">dBFS</span>
        </div>
      </div>
    </section>
  )
}
