import InfoTip from '../InfoTip'

interface Props {
  title: string
  sub?: string
  tip?: string
  bypassed?: boolean
  onToggle?: (bypassed: boolean) => void
}

export default function ModuleHeader({ title, sub, tip, bypassed, onToggle }: Props) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <h4 className="text-[13px] font-bold text-ink tracking-tight shrink-0">{title}</h4>
        {tip && <InfoTip text={tip} label={`${title} 설명`} />}
        {sub && <span className="text-[11px] text-mute-3 truncate ml-1">{sub}</span>}
      </div>
      {onToggle && (
        <button
          type="button"
          onClick={() => onToggle(!bypassed)}
          className={`text-[11px] px-2.5 py-1 rounded-md transition-colors shrink-0 ${
            bypassed ? 'text-mute-3 border border-mute-2 hover:border-mute-3' : 'text-paper bg-accent'
          }`}
        >
          {bypassed ? '꺼짐' : '켜짐'}
        </button>
      )}
    </div>
  )
}
