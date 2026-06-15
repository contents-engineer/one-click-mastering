import { useEffect, useId, useRef, useState } from 'react'

interface Props {
  text: string
  label?: string
}

/**
 * Small ⓘ info icon with a plain-language popover. Opens on hover (desktop) or
 * tap/click (touch), closes on outside-click or ESC. Keyboard accessible.
 */
export default function InfoTip({ text, label }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={ref} className="relative inline-flex items-center align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label ?? '도움말'}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className="flex items-center justify-center w-[15px] h-[15px] rounded-full border border-mute-2 text-[9px] font-semibold leading-none text-mute-3 hover:text-ink hover:border-mute-3 transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 max-w-[78vw] p-3 rounded-lg bg-mute-1 border border-mute-2 shadow-lg text-left text-[12px] font-normal normal-case tracking-normal leading-relaxed text-mute-4 whitespace-normal pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  )
}
