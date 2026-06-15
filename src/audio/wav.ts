/**
 * WAV (RIFF/WAVE PCM) encoder + download helper. Ported verbatim from `wf`/`Am`.
 * Supports 16-bit PCM, 24-bit PCM, and 32-bit float, with optional TPDF dither.
 */

export type BitDepth = 16 | 24 | 32

export interface WavOptions {
  bitDepth?: BitDepth
  dither?: boolean
  maxDurationSec?: number
}

/** Triangular (TPDF) dither sample, ±1 LSB. */
function tpdf(): number {
  return Math.random() - Math.random()
}

export function encodeWav(buffer: AudioBuffer, opts: WavOptions = {}): Blob {
  const bitDepth = opts.bitDepth ?? 24
  const dither = opts.dither ?? true
  const channels = Math.min(2, buffer.numberOfChannels)
  const sampleRate = buffer.sampleRate
  const frames = opts.maxDurationSec
    ? Math.min(buffer.length, Math.floor(opts.maxDurationSec * sampleRate))
    : buffer.length
  const isFloat = bitDepth === 32
  const audioFormat = isFloat ? 3 : 1
  const bytesPerSample = bitDepth / 8
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = frames * blockAlign
  const totalSize = 44 + dataSize
  const ab = new ArrayBuffer(totalSize)
  const view = new DataView(ab)
  let pos = 0

  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos++, s.charCodeAt(i))
  }
  const writeU32 = (v: number) => {
    view.setUint32(pos, v, true)
    pos += 4
  }
  const writeU16 = (v: number) => {
    view.setUint16(pos, v, true)
    pos += 2
  }

  writeStr('RIFF')
  writeU32(totalSize - 8)
  writeStr('WAVE')
  writeStr('fmt ')
  writeU32(16)
  writeU16(audioFormat)
  writeU16(channels)
  writeU32(sampleRate)
  writeU32(byteRate)
  writeU16(blockAlign)
  writeU16(bitDepth)
  writeStr('data')
  writeU32(dataSize)

  const ch0 = buffer.getChannelData(0)
  const ch1 = channels > 1 ? buffer.getChannelData(1) : ch0
  const maxVal = bitDepth === 24 ? 8388607 : 32767
  const minVal = bitDepth === 24 ? -8388608 : -32768
  const ditherScale = bitDepth === 24 ? 1 / 8388608 : 1 / 32768

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = c === 0 ? ch0[i] : ch1[i]
      if (isFloat) {
        view.setFloat32(pos, sample, true)
        pos += 4
        continue
      }
      const dithered = dither ? sample + tpdf() * ditherScale : sample
      const clamped = Math.max(-1, Math.min(1, dithered))
      let q = Math.round(clamped * maxVal)
      if (q > maxVal) q = maxVal
      if (q < minVal) q = minVal
      if (bitDepth === 24) {
        if (q < 0) q += 16777216
        view.setUint8(pos++, q & 255)
        view.setUint8(pos++, (q >> 8) & 255)
        view.setUint8(pos++, (q >> 16) & 255)
      } else {
        view.setInt16(pos, q, true)
        pos += 2
      }
    }
  }

  return new Blob([ab], { type: 'audio/wav' })
}

/** 16-bit, no-dither preview blob URL for the "Before"/original `<audio>`. */
export function previewUrl(buffer: AudioBuffer): string {
  return URL.createObjectURL(encodeWav(buffer, { bitDepth: 16, dither: false }))
}

/** Trigger a browser download of a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
