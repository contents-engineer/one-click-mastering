import { useState } from 'react'

interface Props {
  onFile: (file: File) => void
}

export default function DropZone({ onFile }: Props) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) onFile(file)
      }}
      className={`border-2 border-dashed rounded-xl px-7 py-16 text-center transition-colors bg-paper ${
        dragging ? 'border-accent' : 'border-mute-2 hover:border-mute-3'
      }`}
    >
      <p className="text-[18px] font-semibold text-ink mb-2">AI음악 곡을 여기 놓아주세요</p>
      <p className="text-[14px] text-mute-4 mb-6">WAV · MP3 · M4A · FLAC · 60MB 이하 · 10분 이하</p>
      <label className="inline-block px-5 py-3 bg-ink text-paper rounded-lg cursor-pointer text-[14px] font-medium hover:bg-mute-4 transition-colors">
        파일 선택
        <input
          type="file"
          className="hidden"
          accept="audio/*,.wav,.mp3,.m4a,.flac,.aac,.ogg,.opus"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ''
          }}
        />
      </label>
      <p className="text-[12px] text-mute-3 mt-6">업로드 없이 브라우저에서 직접 처리됩니다. 파일이 서버로 전송되지 않습니다.</p>
    </div>
  )
}
