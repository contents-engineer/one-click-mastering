// Small formatting helpers for the meters / readouts.

export function fmtLufs(v: number, digits = 1): string {
  return isFinite(v) ? v.toFixed(digits) : '—'
}

export function fmtDb(v: number, digits = 1): string {
  if (!isFinite(v)) return '—'
  const s = v.toFixed(digits)
  return v > 0 ? `+${s}` : s
}

export function fmtSigned(v: number, digits = 1): string {
  if (!isFinite(v)) return '—'
  const s = v.toFixed(digits)
  return v > 0 ? `+${s}` : s
}

/** seconds → m:ss */
export function fmtClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function fmtKHz(sampleRate: number): string {
  return (sampleRate / 1000).toFixed(1)
}
