export default function Footer() {
  return (
    <footer className="mt-20 pt-6 border-t border-mute-2 text-[11px] text-mute-3 leading-relaxed">
      <p>
        마스터링은 브라우저(Web Audio API)에서 처리됩니다. 음원 파일은{' '}
        <span className="text-mute-4">‘프로젝트 저장’ 시에만</span> 불러오기 용도로 서버에 안전하게 보관되며, 본인만
        접근할 수 있습니다. 저장하지 않으면 어떤 파일도 서버로 전송되지 않습니다.
      </p>
      <p className="mt-2">
        © 2026 Manex · 주코드(Zoochord) · 대표 주형찬 · 사업자등록번호 662-03-03053 · 통신판매업신고
        제2026-화도수동-0303호 · 경기도 남양주시 수동면 송천2길 12-16 · jakejoo@zoochord.com
      </p>
    </footer>
  )
}
