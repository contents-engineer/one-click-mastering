/**
 * File validation + decode. Ported verbatim from `xh` (size → ext → decode → duration).
 */
import type { DecodedTrack } from './types'

export const MAX_SIZE_BYTES = 60 * 1024 * 1024 // 60 MB
export const MAX_DURATION_SEC = 600 // 10 min
export const ACCEPTED_EXT = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'] as const

export type DecodeErrorCode =
  | 'TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'DECODE_FAILED'
  | 'TOO_LONG'

export class DecodeError extends Error {
  code: DecodeErrorCode
  constructor(message: string, code: DecodeErrorCode) {
    super(message)
    this.code = code
    this.name = 'DecodeError'
  }
}

function extOf(name: string): string | null {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : null
}

export async function validateAndDecode(file: File): Promise<DecodedTrack> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new DecodeError(
      `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). 60MB 이하만 가능합니다.`,
      'TOO_LARGE',
    )
  }
  const ext = extOf(file.name)
  if (!ext || !ACCEPTED_EXT.includes(ext as (typeof ACCEPTED_EXT)[number])) {
    throw new DecodeError(
      `지원하지 않는 포맷입니다 (.${ext ?? '?'}). WAV·MP3·M4A·FLAC 등을 사용해주세요.`,
      'UNSUPPORTED_FORMAT',
    )
  }

  const arrayBuffer = await file.arrayBuffer()
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtx()
  let buffer: AudioBuffer
  try {
    buffer = await ctx.decodeAudioData(arrayBuffer)
  } catch {
    throw new DecodeError('디코딩에 실패했습니다. 다른 파일로 시도해주세요.', 'DECODE_FAILED')
  } finally {
    ctx.close()
  }

  if (buffer.duration > MAX_DURATION_SEC) {
    throw new DecodeError(`너무 깁니다 (${buffer.duration.toFixed(0)}초). 10분 이하만 가능합니다.`, 'TOO_LONG')
  }

  return { buffer, fileName: file.name, fileSize: file.size }
}
