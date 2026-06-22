export default function Footer() {
  return (
    <footer className="mt-20 pt-6 border-t border-mute-2 text-[11px] text-mute-3 leading-relaxed">
      <p>
        모든 마스터링은 브라우저(Web Audio API)에서 처리됩니다. 회원가입·업로드 없이 동작하며,{' '}
        <span className="text-mute-4">음원 파일은 서버로 전송되지 않습니다.</span>
      </p>
      <p className="mt-2">© 2026 Manex</p>
    </footer>
  )
}
