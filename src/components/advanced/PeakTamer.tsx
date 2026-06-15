import ModuleHeader from './ModuleHeader'
import { GUIDE } from '../../guide'
import type { MasteringChain } from '../../audio/types'

interface Props {
  peakStage: MasteringChain['peakStage']
  grDb: number
  onChangeDrive: (db: number) => void
  onToggle: (bypassed: boolean) => void
}

export default function PeakTamer({ peakStage, grDb, onChangeDrive, onToggle }: Props) {
  // GR meter: 0..4 dB range, zones safe (<1.5) / caution (1.5–3) / danger (>3).
  const grPct = Math.min(1, grDb / 4) * 100
  const grColor = grDb >= 3 ? '#d14343' : grDb >= 1.5 ? '#e0a23a' : '#00B899'

  return (
    <div className="border border-mute-2 rounded-xl p-4 bg-paper">
      <ModuleHeader
        title="피크 테이머"
        sub="가장 큰 피크를 잡아 음압 여력을 확보합니다 (리미터 앞)."
        tip={GUIDE.peakTamer}
        bypassed={peakStage.bypassed}
        onToggle={onToggle}
      />

      <div className="mb-1 text-[11px] text-mute-4">게인 리덕션 (실시간)</div>
      <div className="relative h-2 bg-mute-1 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-75" style={{ width: `${grPct}%`, background: grColor }} />
      </div>
      <div className="flex justify-between text-[9px] text-mute-3 mt-1 tabular-nums">
        <span>안전</span>
        <span>주의 1.5</span>
        <span>위험 3</span>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-[11px] mb-1">
          <span className="text-mute-4">드라이브 (피크 정리량)</span>
          <span className="tabular-nums text-mute-3">{peakStage.driveDb.toFixed(1)} dB</span>
        </div>
        <input
          type="range"
          aria-label="클리퍼 드라이브"
          className="drive-fader w-full"
          min={0}
          max={8}
          step={0.5}
          value={peakStage.driveDb}
          onChange={(e) => onChangeDrive(Number(e.target.value))}
          onDoubleClick={() => onChangeDrive(0)}
          style={{ accentColor: '#f5f5f5' }}
        />
      </div>
    </div>
  )
}
