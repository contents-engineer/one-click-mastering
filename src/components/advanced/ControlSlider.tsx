interface Props {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  onReset?: () => void
  ariaLabel?: string
}

/** A labelled horizontal fader row used by the advanced compressor / limiter / multiband controls. */
export default function ControlSlider({ label, value, min, max, step, format, onChange, onReset, ariaLabel }: Props) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] mb-1">
        <span className="text-mute-4">{label}</span>
        <span className="tabular-nums text-mute-3">{format(value)}</span>
      </div>
      <input
        type="range"
        aria-label={ariaLabel ?? label}
        className="drive-fader w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={onReset}
        style={{ accentColor: '#f5f5f5' }}
      />
    </div>
  )
}
