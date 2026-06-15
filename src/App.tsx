import { useCallback, useRef, useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import DropZone from './components/DropZone'
import MasteringView from './components/MasteringView'
import { validateAndDecode, DecodeError } from './audio/decode'
import { analyzeLoudness } from './audio/loudness'
import { previewUrl as makePreviewUrl } from './audio/wav'
import type { DecodedTrack, LoudnessAnalysis } from './audio/types'

type Stage = 'idle' | 'decoding' | 'ready' | 'error'

export default function App() {
  const [stage, setStage] = useState<Stage>('idle')
  const [track, setTrack] = useState<DecodedTrack | null>(null)
  const [analysis, setAnalysis] = useState<LoudnessAnalysis | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const urlRef = useRef<string | null>(null)

  const revoke = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }

  const handleFile = useCallback(async (file: File) => {
    revoke()
    setStage('decoding')
    try {
      const decoded = await validateAndDecode(file)
      const loud = await analyzeLoudness(decoded.buffer)
      const url = makePreviewUrl(decoded.buffer)
      urlRef.current = url
      setTrack(decoded)
      setAnalysis(loud)
      setPreviewUrl(url)
      setStage('ready')
    } catch (e) {
      const message = e instanceof DecodeError ? e.message : '파일 처리 중 오류가 발생했습니다.'
      setErrorMessage(message)
      setStage('error')
    }
  }, [])

  const reset = useCallback(() => {
    revoke()
    setTrack(null)
    setAnalysis(null)
    setPreviewUrl(null)
    setErrorMessage('')
    setStage('idle')
  }, [])

  return (
    <>
      <Header />
      <main className="max-w-[920px] mx-auto px-7 py-8">
        {stage === 'idle' && (
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-[14px] text-ink font-medium">AI음악 음원을 올리면 자동으로 마스터링합니다</p>
              <p className="text-[12px] text-mute-4 mt-1">
                선형 게인으로 음압을 올리고 트루피크 리미터로 안전하게 — 다이내믹 손상 없이.
              </p>
            </div>
            <DropZone onFile={handleFile} />
          </div>
        )}

        {stage === 'decoding' && (
          <div className="py-16 text-center space-y-4">
            <p className="text-[15px] text-ink font-medium">파일을 분석하고 있습니다…</p>
            <p className="text-[12px] text-mute-4">디코딩 · 원본 라우드니스 측정 중</p>
            <div className="max-w-[280px] mx-auto h-1 bg-mute-1 rounded overflow-hidden">
              <div className="loadbar-indeterminate h-full bg-ink rounded" />
            </div>
          </div>
        )}

        {stage === 'error' && (
          <div className="border border-mute-2 rounded-xl p-8 bg-paper text-center space-y-4">
            <p className="text-[15px] font-bold text-ink">오류가 발생했습니다</p>
            <p className="text-[13px] text-mute-4">{errorMessage}</p>
            <button
              type="button"
              onClick={reset}
              className="px-5 py-2.5 bg-ink text-paper rounded-lg text-[13px] font-medium hover:bg-mute-4 transition-colors"
            >
              다시 시도하기
            </button>
          </div>
        )}

        {stage === 'ready' && track && analysis && previewUrl && (
          <MasteringView track={track} analysis={analysis} previewUrl={previewUrl} onReset={reset} />
        )}

        <Footer />
      </main>
    </>
  )
}
