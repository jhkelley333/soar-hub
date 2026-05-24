// Illustrated Sonic cup — the launch-splash hero. Hand-built to match
// the Claude Design "Launch / splash" render: frosted glass tumbler with
// a light-blue carbonated fill, floating ice cubes, rising bubbles, a
// red straw, a white lid, and glass gloss. Reads on the navy splash
// backdrop. Scales by height; width follows the 244×348 viewBox.

const ICE = [
  { x: 98, y: 168, s: 46, r: -12 },
  { x: 154, y: 154, s: 36, r: 9 },
  { x: 122, y: 214, s: 50, r: 15 },
  { x: 162, y: 252, s: 38, r: -8 },
  { x: 102, y: 274, s: 34, r: 20 },
];

const BUBBLES = [
  [86, 300, 2.6], [150, 296, 3], [172, 232, 2], [80, 206, 2.1],
  [184, 192, 2.5], [110, 312, 1.8], [140, 262, 1.6], [96, 238, 2.2],
  [166, 304, 2], [128, 184, 1.8], [190, 268, 2], [74, 256, 1.6],
];

export function SplashCup({
  className,
  agitate = 0,
}: {
  className?: string;
  /** Increment to make the ice cubes rattle (shake / tap). */
  agitate?: number;
}) {
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
          <stop offset="0%" stopColor="#d6edfa" />
          <stop offset="50%" stopColor="#9fd1ea" />
          <stop offset="100%" stopColor="#7ec3e0" />
        </linearGradient>
        <linearGradient id="splashGlass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.16)" />
          <stop offset="45%" stopColor="rgba(255,255,255,0.03)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.10)" />
        </linearGradient>
        <linearGradient id="splashStraw" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6cc6ee" />
          <stop offset="55%" stopColor="#1390cf" />
          <stop offset="100%" stopColor="#0a5f8a" />
        </linearGradient>
        <clipPath id="splashCupInside">
          <path d="M 46 98 L 198 98 L 176 320 L 68 320 Z" />
        </clipPath>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="122" cy="332" rx="66" ry="7" fill="rgba(0,0,0,0.22)" />

      {/* Glass body (frosted) */}
      <path d="M 40 96 L 204 96 L 180 322 L 64 322 Z" fill="url(#splashGlass)" />

      {/* Liquid + ice + bubbles, clipped to the cup interior */}
      <g clipPath="url(#splashCupInside)">
        <rect x="28" y="120" width="188" height="212" fill="url(#splashLiquid)" />

        {/* Surface ripple */}
        <path
          d="M 36 122 Q 66 116 96 122 T 156 122 T 216 122 L 216 134 L 36 134 Z"
          fill="rgba(255,255,255,0.30)"
        />
        <path
          d="M 36 123 Q 66 117 96 123 T 156 123 T 216 123"
          fill="none"
          stroke="rgba(255,255,255,0.8)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />

        {/* Ice cubes — inner group rattles when `agitate` changes */}
        {ICE.map((c, i) => (
          <g key={i} transform={`translate(${c.x} ${c.y}) rotate(${c.r})`}>
            <g
              key={agitate}
              className={agitate > 0 ? "ice-jiggle" : undefined}
              style={{ animationDelay: `${(i % 5) * 45}ms` }}
            >
              <rect
                x={-c.s / 2}
                y={-c.s / 2}
                width={c.s}
                height={c.s}
                rx={c.s * 0.16}
                fill="rgba(255,255,255,0.50)"
                stroke="rgba(255,255,255,0.75)"
                strokeWidth="1.2"
              />
              <rect
                x={-c.s / 2 + 5}
                y={-c.s / 2 + 5}
                width={c.s * 0.34}
                height={c.s * 0.14}
                rx={c.s * 0.07}
                fill="rgba(255,255,255,0.85)"
              />
            </g>
          </g>
        ))}

        {/* Carbonation — rises and fades on a loop */}
        {BUBBLES.map(([cx, cy, r], i) => (
          <circle
            key={i}
            className="splash-bubble"
            cx={cx}
            cy={cy}
            r={r}
            fill="rgba(255,255,255,0.55)"
            style={{
              animationDuration: `${2.8 + (i % 4) * 0.7}s`,
              animationDelay: `${((i * 0.37) % 3).toFixed(2)}s`,
            }}
          />
        ))}

        {/* Left gloss streak */}
        <rect x="58" y="112" width="9" height="200" rx="4.5" fill="rgba(255,255,255,0.12)" />
      </g>

      {/* Glass outline + rim */}
      <path
        d="M 40 96 L 204 96 L 180 322 L 64 322 Z"
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <ellipse cx="122" cy="96" rx="82" ry="6" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" />

      {/* Lid */}
      <g>
        <rect x="30" y="82" width="184" height="17" rx="3" fill="#ffffff" />
        <rect x="40" y="85" width="164" height="9" rx="1.5" fill="url(#splashLiquid)" />
        <rect x="32" y="83" width="180" height="2" rx="1" fill="rgba(255,255,255,0.95)" />
      </g>

      {/* Straw — drawn last so it reads as poking out of the lid */}
      <path
        d="M 150 178 L 176 26"
        stroke="url(#splashStraw)"
        strokeWidth="14"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 153 176 L 179 28"
        stroke="rgba(255,255,255,0.40)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
