import ModuleHeader from './ModuleHeader'
import ControlSlider from './ControlSlider'
import { GUIDE } from '../../guide'
import type { MasteringChain, MultibandBand } from '../../audio/types'

interface Props {
  mb: MasteringChain['mb']
  onChangeBand: (index: number, partial: Partial<MultibandBand>) => void
  onToggle: (bypassed: boolean) => void
}

const BAND_LABELS = ['Low', 'Mid', 'High']

export default function Multiband({ mb, onChangeBand, onToggle }: Props) {
  return (
    <div className="border border-mute-2 rounded-xl p-4 bg-paper">
      <ModuleHeader
        title="멀티밴드"
        sub={`${mb.crossoverLow} / ${mb.crossoverHigh} Hz`}
        tip={GUIDE.multiband}
        bypassed={mb.bypassed}
        onToggle={onToggle}
      />
      <div className="grid grid-cols-3 gap-4">
        {mb.bands.map((band, i) => (
          <div key={i} className="space-y-3">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mute-3 text-center">{BAND_LABELS[i]}</div>
            <ControlSlider
              label="Thr"
              value={band.threshold}
              min={-60}
              max={0}
              step={0.5}
              format={(v) => `${v.toFixed(1)}`}
              onChange={(v) => onChangeBand(i, { threshold: v })}
            />
            <ControlSlider
              label="Ratio"
              value={band.ratio}
              min={1}
              max={10}
              step={0.1}
              format={(v) => `${v.toFixed(1)}:1`}
              onChange={(v) => onChangeBand(i, { ratio: v })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
