import { QUICK_GUIDE } from '../guide'

interface Props {
  onClose: () => void
}

export default function QuickGuide({ onClose }: Props) {
  return (
    <div className="relative rounded-xl border border-accent/40 bg-mute-1 p-5">
      <button
        type="button"
        onClick={onClose}
        aria-label="가이드 닫기"
        className="absolute top-3 right-3 text-[14px] text-mute-3 hover:text-ink transition-colors leading-none"
      >
        ✕
      </button>
      <p className="text-[14px] font-bold text-ink mb-3">{QUICK_GUIDE.title}</p>
      <ol className="space-y-2">
        {QUICK_GUIDE.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[13px] text-mute-4">
            <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-accent text-paper text-[11px] font-bold flex items-center justify-center">
              {i + 1}
            </span>
            <span className="leading-relaxed">{s}</span>
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-mute-3 mt-3 leading-relaxed">{QUICK_GUIDE.tip}</p>
    </div>
  )
}
