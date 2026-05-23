// Small Sonic cup mark in cherry red. Used sparingly per the brief —
// brand red is accent-only (the cup glyph itself + occasional flag
// counts). For a larger illustrated cup (e.g. the splash backdrop) use
// the dedicated splash component instead.

export function CupMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      role="img"
    >
      <path
        d="M5 6h10l-.9 9.2a1.5 1.5 0 0 1-1.5 1.3H7.4a1.5 1.5 0 0 1-1.5-1.3L5 6Z"
        fill="#E40046"
      />
      <rect x="4.3" y="5" width="11.4" height="1.6" rx=".5" fill="#E40046" />
      <path
        d="M9 8.5v6M11 8.5v6"
        stroke="#fff"
        strokeOpacity=".55"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
