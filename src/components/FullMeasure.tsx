import { fmtLufs, fmtSigned } from '../lib/format'
import InfoTip from './InfoTip'
import { GUIDE } from '../guide'

export interface MeasureResult {
  before: { lufsI: number; truePeakDb: number }
  after: { lufsI: number; truePeakDb: number }
  time: string
}

interface Props {
  result: MeasureResult | null
  measuring: boolean
  targetLufs: number
  onMeasure: () => void
}

function Col({
  title,
  sub,
  lufs,
  tp,
  dark,
  signed,
}: {
  title: string
  sub: string
  lufs: string
  tp: string
  dark?: boolean
  signed?: boolean
}) {
  const labelColor = dark ? 'text-mute-2' : 'text-mute-3'
  const rowLabel = dark ? 'text-mute-2' : 'text-mute-4'
  return (
    <div className={`p-3 rounded-lg ${dark ? 'bg-ink text-paper' : 'bg-mute-1'}`}>
      <div className={`text-[10px] uppercase tracking-wider font-bold ${labelColor}`}>{title}</div>
      <div className={`text-[9px] mt-0.5 ${labelColor}`}>{sub}</div>
      <div className="mt-2 space-y-1">
        <div className="flex items-baseline justify-between text-[12px]">
          <span className={rowLabel}>LUFS-I</span>
          <span className="font-bold tabular-nums">{lufs}</span>
        </div>
        <div className="flex items-baseline justify-between text-[11px]">
          <span className={rowLabel}>True Peak</span>
          <span className="font-medium tabular-nums">{tp}{signed ? '' : ''} dBTP</span>
        </div>
      </div>
    </div>
  )
}

export default function FullMeasure({ result, measuring, targetLufs, onMeasure }: Props) {
  return (
    <div className="border border-mute-2 rounded-xl p-5 bg-paper">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-ink tracking-tight">
            전체 측정
            <InfoTip text={GUIDE.fullMeasure} label="전체 측정 설명" />
          </h3>
          <span className="text-[11px] text-mute-3">처음부터 끝까지 오프라인 렌더 → 적분 LUFS 비교 (체인 상태 그대로)</span>
        </div>
        <button
          type="button"
          onClick={onMeasure}
          disabled={measuring}
          className="px-4 py-2 text-[13px] font-medium bg-ink text-paper rounded-lg disabled:opacity-50 hover:bg-mute-4 transition-colors"
        >
          {measuring ? '측정 중…' : result ? '다시 측정' : '전체 측정 시작'}
        </button>
      </div>
      {result && (
        <>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Col title="Before" sub="원본 (체인 적용 전)" lufs={fmtLufs(result.before.lufsI)} tp={`${fmtLufs(result.before.truePeakDb)}`} />
            <Col title="After" sub={`타깃 ${targetLufs} LUFS`} lufs={fmtLufs(result.after.lufsI)} tp={`${fmtLufs(result.after.truePeakDb)}`} dark />
            <Col
              title="변화"
              sub="After − Before"
              lufs={fmtSigned(result.after.lufsI - result.before.lufsI)}
              tp={fmtSigned(result.after.truePeakDb - result.before.truePeakDb)}
              signed
            />
          </div>
          <p className="text-[10px] text-mute-3 mt-3">측정 시각: {result.time}· 노브를 만지면 다시 측정해야 정확합니다</p>
        </>
      )}
    </div>
  )
}
