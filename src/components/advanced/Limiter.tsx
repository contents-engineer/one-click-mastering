import ModuleHeader from './ModuleHeader'
import ControlSlider from './ControlSlider'
import { fmtDb } from '../../lib/format'
import { GUIDE } from '../../guide'
import type { MasteringChain } from '../../audio/types'

interface Props {
  limiter: MasteringChain['limiter']
  autoMakeupDb: number
  onChange: (partial: Partial<MasteringChain['limiter']>) => void
  onToggle: (bypassed: boolean) => void
}

export default function Limiter({ limiter, autoMakeupDb, onChange, onToggle }: Props) {
  return (
    <div className="border border-mute-2 rounded-xl p-4 bg-paper">
      <ModuleHeader title="리미터" tip={GUIDE.limiter} bypassed={limiter.bypassed} onToggle={onToggle} />
      <div className="space-y-3">
        <ControlSlider
          label="Ceiling"
          value={limiter.ceiling}
          min={-6}
          max={0}
          step={0.1}
          format={(v) => `${v.toFixed(1)} dBTP`}
          onChange={(v) => onChange({ ceiling: v })}
        />
        <ControlSlider
          label="Release"
          value={limiter.release}
          min={0.01}
          max={0.5}
          step={0.005}
          format={(v) => `${(v * 1000).toFixed(0)} ms`}
          onChange={(v) => onChange({ release: v })}
        />
      </div>
      <p className="text-[11px] text-mute-4 mt-3 tabular-nums">자동 makeup {fmtDb(autoMakeupDb)}dB 적용 중</p>
      <p className="text-[11px] text-mute-3 mt-2 leading-relaxed">
        전체 리미팅 양은 맨 위 <span className="text-mute-4">리미팅 드라이브 페이더</span>로 조절하세요. Ceiling은 천장(보통 −1dB),
        Release는 리미터 회복 속도입니다.
      </p>
    </div>
  )
}
