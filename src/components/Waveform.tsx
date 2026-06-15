import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  buffer: AudioBuffer
  currentTime: number
  duration: number
  selection: { start: number; end: number } | null
  onSeek: (t: number) => void
  onSelect: (sel: { start: number; end: number } | null) => void
}

const WIDTH = 1000
const HEIGHT = 96

/** Precompute min/max peaks per column from channel 0 (+1 if stereo, averaged). */
function computePeaks(buffer: AudioBuffer, columns: number): Float32Array {
  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0
  const peaks = new Float32Array(columns)
  const block = Math.floor(ch0.length / columns) || 1
  for (let c = 0; c < columns; c++) {
    let max = 0
    const start = c * block
    const end = Math.min(start + block, ch0.length)
    for (let i = start; i < end; i++) {
      const a = (Math.abs(ch0[i]) + Math.abs(ch1[i])) / 2
      if (a > max) max = a
    }
    peaks[c] = max
  }
  return peaks
}

export default function Waveform({ buffer, currentTime, duration, selection, onSeek, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaks = useMemo(() => computePeaks(buffer, WIDTH), [buffer])
  const [drag, setDrag] = useState<{ from: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    const mid = HEIGHT / 2

    // selection band
    if (selection && duration > 0) {
      const x0 = (selection.start / duration) * WIDTH
      const x1 = (selection.end / duration) * WIDTH
      ctx.fillStyle = 'rgba(0,184,153,0.18)'
      ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), HEIGHT)
    }

    // waveform bars
    const progressX = duration > 0 ? (currentTime / duration) * WIDTH : 0
    for (let x = 0; x < WIDTH; x++) {
      const h = Math.max(1, peaks[x] * (HEIGHT * 0.92))
      ctx.fillStyle = x <= progressX ? '#f5f5f5' : '#3a3a3a'
      ctx.fillRect(x, mid - h / 2, 1, h)
    }

    // playhead
    if (duration > 0) {
      ctx.fillStyle = '#00B899'
      ctx.fillRect(progressX, 0, 1.5, HEIGHT)
    }
  }, [peaks, currentTime, duration, selection])

  const posToTime = (clientX: number): number => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      className="w-full h-24 rounded-md bg-mute-1 cursor-pointer select-none"
      onPointerDown={(e) => {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        setDrag({ from: posToTime(e.clientX) })
      }}
      onPointerMove={(e) => {
        if (!drag) return
        const to = posToTime(e.clientX)
        if (Math.abs(to - drag.from) > duration * 0.01) {
          onSelect({ start: Math.min(drag.from, to), end: Math.max(drag.from, to) })
        }
      }}
      onPointerUp={(e) => {
        if (drag) {
          const to = posToTime(e.clientX)
          if (Math.abs(to - drag.from) <= duration * 0.01) onSeek(drag.from)
        }
        setDrag(null)
      }}
      onDoubleClick={() => onSelect(null)}
    />
  )
}
