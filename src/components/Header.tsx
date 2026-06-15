export default function Header() {
  return (
    <header className="border-b border-mute-2">
      <div className="max-w-prose mx-auto px-7 py-5 grid grid-cols-3 items-center">
        <a href="/" className="text-[13px] text-mute-3 hover:text-ink transition-colors justify-self-start">
          ← 홈
        </a>
        <span className="text-center text-[15px] font-bold tracking-tight text-ink">Manex</span>
        <span aria-hidden className="justify-self-end" />
      </div>
    </header>
  )
}
