// Illustrated Sonic cup — the launch-splash hero. This is the "larger
// illustrated cup" the CupMark note points to; CupMark stays the small
// inline glyph, this is the splash backdrop. Geometry imported from the
// Claude Design "Launch / splash" canvas. Scales by height; width
// follows the 244×348 viewBox. Brand frost/sky gradient for the liquid.

export function SplashCup({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 244 348"
      className={className}
      role="img"
      aria-label="SOAR cup"
    >
      <defs>
        <linearGradient id="splashLiquid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfe9f7" />
          <stop offset="55%" stopColor="#9fd1ea" />
          <stop offset="100%" stopColor="#7ec3e0" />
        </linearGradient>
        <linearGradient id="splashWallTint" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.20)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(40,87,128,0.18)" />
        </linearGradient>
        <clipPath id="splashCupInside">
          <path d="M 36 76 L 208 76 L 184 322 L 60 322 Z" />
        </clipPath>
      </defs>

      {/* Liquid body + wall tint */}
      <path d="M 36 76 L 208 76 L 184 322 L 60 322 Z" fill="url(#splashLiquid)" />
      <path d="M 36 76 L 208 76 L 184 322 L 60 322 Z" fill="url(#splashWallTint)" />

      {/* Surface ripple, clipped to the cup interior */}
      <g clipPath="url(#splashCupInside)">
        <path
          d=" M 30 92 Q 50 80, 70 92 T 110 92 T 150 92 T 190 92 T 230 92 L 230 110 L 30 110 Z "
          fill="rgba(255,255,255,0.45)"
        />
        <path
          d=" M 30 94 Q 50 84, 70 94 T 110 94 T 150 94 T 190 94 T 230 94 "
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>

      {/* Cup outline */}
      <path
        d="M 36 76 L 208 76 L 184 322 L 60 322 Z"
        fill="none"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      {/* Lid */}
      <g>
        <rect x="22" y="56" width="200" height="20" rx="3" fill="#ffffff" />
        <rect x="36" y="60" width="172" height="12" rx="1.5" fill="url(#splashLiquid)" />
        <rect x="36" y="72" width="172" height="3" fill="rgba(40,87,128,0.35)" />
        <rect x="24" y="58" width="196" height="2" rx="1" fill="rgba(255,255,255,0.95)" />
      </g>

      {/* Base shadow ring */}
      <ellipse
        cx="122"
        cy="322"
        rx="62"
        ry="5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeOpacity="0.85"
      />
    </svg>
  );
}
