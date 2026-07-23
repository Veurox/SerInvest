// =============================================================================
// Aurion — Logo
// "Aur-ion" = altın iyonu. İşaret: gümüşi yörüngede dönen iki elektronlu
// (canlı/dinamik) bir atom çekirdeği. Tema renklerine (--yellow) uyumlu.
// =============================================================================
const ORBIT = 'M3 16 a13 4.6 0 1 0 26 0 a13 4.6 0 1 0 -26 0'

export function Logo() {
  return (
    <div className="logo" aria-label="Aurion">
      <svg className="logo-mark" viewBox="0 0 32 32" role="img" aria-hidden="true">
        <g transform="rotate(-22 16 16)">
          <ellipse className="logo-orbit" cx="16" cy="16" rx="13" ry="4.6" />
          <circle className="logo-e" r="1.9">
            <animateMotion dur="3.6s" repeatCount="indefinite" path={ORBIT} />
          </circle>
          <circle className="logo-e" r="1.9">
            <animateMotion dur="3.6s" begin="-1.8s" repeatCount="indefinite" path={ORBIT} />
          </circle>
        </g>
        <circle className="logo-nucleus" cx="16" cy="16" r="3.3" />
      </svg>
      Aur<span>ion</span>
    </div>
  )
}
