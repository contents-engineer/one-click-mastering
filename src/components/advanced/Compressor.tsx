import ModuleHeader from './ModuleHeader'
import ControlSlider from './ControlSlider'
import { GUIDE } from '../../guide'
import type { MasteringChain } from '../../audio/types'

interface Props {
  comp: MasteringChain['comp']
  onChange: (partial: Partial<MasteringChain['comp']>) => void
  onToggle: (bypassed: boolean) => void
}

export default function Compressor({ comp, onChange, onToggle }: Props) {
  return (
    <div className="border border-mute-2 rounded-xl p-4 bg-paper">
      <ModuleHeader title="컴프레서" sub="Glue 단일 밴드" tip={GUIDE.compressor} bypassed={comp.bypassed} onToggle={onToggle} />
      <div className="space-y-3">
        <ControlSlider
          label="Threshold"
          value={comp.threshold}
          min={-60}
          max={0}
          step={0.5}
          format={(v) => `${v.toFixed(1)} dB`}
          onChange={(v) => onChange({ threshold: v })}
        />
        <ControlSlider
          label="Ratio"
          value={comp.ratio}
          min={1}
          max={20}
          step={0.1}
          format={(v) => `${v.toFixed(1)}:1`}
          onChange={(v) => onChange({ ratio: v })}
        />
        <ControlSlider
          label="Attack"
          value={comp.attack}
          min={0}
          max={0.5}
          step={0.001}
          format={(v) => `${(v * 1000).toFixed(0)} ms`}
          onChange={(v) => onChange({ attack: v })}
        />
        <ControlSlider
          label="Release"
          value={comp.release}
          min={0.01}
          max={1}
          step={0.01}
          format={(v) => `${(v * 1000).toFixed(0)} ms`}
          onChange={(v) => onChange({ release: v })}
        />
      </div>
    </div>
  )
}
