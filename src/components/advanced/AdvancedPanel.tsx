import { useState } from 'react'
import EqGraph from './EqGraph'
import Compressor from './Compressor'
import Multiband from './Multiband'
import Limiter from './Limiter'
import PeakTamer from './PeakTamer'
import OutputFormat from './OutputFormat'
import InfoTip from '../InfoTip'
import { GUIDE } from '../../guide'
import type { BitDepth } from '../../audio/wav'
import type { EqBand, MasteringChain, MultibandBand } from '../../audio/types'

export interface ChainEdit {
  eqBand: (i: number, p: Partial<EqBand>) => void
  eqToggle: (bypassed: boolean) => void
  eqFlatten: () => void
  comp: (p: Partial<MasteringChain['comp']>) => void
  compToggle: (bypassed: boolean) => void
  mbBand: (i: number, p: Partial<MultibandBand>) => void
  mbToggle: (bypassed: boolean) => void
  limiter: (p: Partial<MasteringChain['limiter']>) => void
  limiterToggle: (bypassed: boolean) => void
  peakDrive: (db: number) => void
  peakToggle: (bypassed: boolean) => void
}

interface Props {
  chain: MasteringChain
  clipperGr: number
  bitDepth: BitDepth
  dither: boolean
  onBitDepth: (d: BitDepth) => void
  onDither: (v: boolean) => void
  onAutoReset: () => void
  edit: ChainEdit
}

export default function AdvancedPanel({ chain, clipperGr, bitDepth, dither, onBitDepth, onDither, onAutoReset, edit }: Props) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between rounded-xl border px-5 py-5 transition-colors border-mute-2 hover:border-ink/20 cursor-pointer"
      >
        <span className="flex items-center gap-2 text-[15px] font-bold text-ink">
          고급 설정
          <span className="ml-1 text-[12px] font-normal text-mute-3">자동 설정 · EQ · 컴프 · 멀티밴드 · 리미터</span>
        </span>
        <span className="text-[18px] text-mute-3">→</span>
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-mute-2">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full flex items-center justify-between px-5 py-5 cursor-pointer"
      >
        <span className="flex items-center gap-2 text-[15px] font-bold text-ink">
          고급 설정
          <span className="ml-1 text-[12px] font-normal text-mute-3">자동 설정 · EQ · 컴프 · 멀티밴드 · 리미터</span>
        </span>
        <span className="text-[18px] text-mute-3">↓</span>
      </button>

      <div className="px-5 pb-5 space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onAutoReset}
            className="px-4 py-2 text-[13px] font-medium bg-ink text-paper rounded-lg hover:bg-mute-4 transition-colors"
          >
            자동 설정
          </button>
          <span className="flex items-center gap-1.5 text-[11px] text-mute-3">
            <InfoTip text={GUIDE.advanced} label="고급 설정 안내" />
            프리셋 기본 톤이 적용되어 있습니다 · 아래에서 직접 조정
          </span>
        </div>

        <PeakTamer peakStage={chain.peakStage} grDb={clipperGr} onChangeDrive={edit.peakDrive} onToggle={edit.peakToggle} />
        <EqGraph bands={chain.eq.bands} bypassed={chain.eq.bypassed} onChangeBand={edit.eqBand} onToggle={edit.eqToggle} onFlatten={edit.eqFlatten} />
        <Compressor comp={chain.comp} onChange={edit.comp} onToggle={edit.compToggle} />
        <Multiband mb={chain.mb} onChangeBand={edit.mbBand} onToggle={edit.mbToggle} />
        <Limiter limiter={chain.limiter} autoMakeupDb={chain.autoMakeupDb} onChange={edit.limiter} onToggle={edit.limiterToggle} />

        <div className="border border-mute-2 rounded-xl p-4 bg-paper">
          <OutputFormat bitDepth={bitDepth} dither={dither} onBitDepth={onBitDepth} onDither={onDither} />
        </div>
      </div>
    </div>
  )
}
