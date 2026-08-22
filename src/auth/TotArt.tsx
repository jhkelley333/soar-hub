// Tot — the second RollerBuddy game character. A cool yellow skater in blue
// shades on blue roller skates (modeled on the SOAR desk toy). Same viewBox +
// props as BuddyArt so the game can swap them freely; the pupil offset nudges
// the lens shine so he "looks" toward the pointer on the landing page.
export function TotArt({
  pupil = { x: 0, y: 0 },
  className,
}: {
  pupil?: { x: number; y: number };
  className?: string;
}) {
  const BLUE = "oklch(0.6 0.19 250)";
  const BLUE_D = "oklch(0.5 0.19 250)";
  const YELLOW = "oklch(0.86 0.17 95)";
  return (
    <svg viewBox="0 0 100 120" className={className}>
      {/* shadow */}
      <ellipse cx="50" cy="115" rx="27" ry="3" fill="rgba(0,0,0,0.18)" />

      {/* arms — one down, one waving up */}
      <path d="M32 54 Q17 62 21 78" stroke={BLUE} strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M68 46 Q85 40 82 24" stroke={BLUE} strokeWidth="7" strokeLinecap="round" fill="none" />

      {/* body — tall yellow cylinder */}
      <rect x="30" y="12" width="40" height="72" rx="19" fill={YELLOW} />
      {/* soft top highlight */}
      <rect x="34" y="16" width="32" height="10" rx="5" fill="rgba(255,255,255,0.28)" />

      {/* sunglasses — connected blue lenses */}
      <g fill={BLUE}>
        <ellipse cx="43" cy="44" rx="8.5" ry="8" />
        <ellipse cx="59" cy="44" rx="8.5" ry="8" />
        <rect x="49" y="41" width="6" height="4" rx="2" />
      </g>
      {/* lens shine (tracks pointer a touch) */}
      <circle cx={40 + pupil.x} cy={41 + pupil.y} r="2.2" fill="rgba(255,255,255,0.55)" />
      <circle cx={56 + pupil.x} cy={41 + pupil.y} r="2.2" fill="rgba(255,255,255,0.55)" />

      {/* smile */}
      <path d="M42 58 Q50 66 58 58" stroke={BLUE} strokeWidth="3" strokeLinecap="round" fill="none" />

      {/* skates — blue boots */}
      <rect x="30" y="82" width="17" height="16" rx="5" fill={BLUE} />
      <rect x="53" y="82" width="17" height="16" rx="5" fill={BLUE} />
      {/* plates */}
      <rect x="28" y="97" width="21" height="4" rx="2" fill={BLUE_D} />
      <rect x="51" y="97" width="21" height="4" rx="2" fill={BLUE_D} />
      {/* wheels */}
      <circle cx="32" cy="106" r="5" fill={BLUE} />
      <circle cx="45" cy="106" r="5" fill={BLUE} />
      <circle cx="55" cy="106" r="5" fill={BLUE} />
      <circle cx="68" cy="106" r="5" fill={BLUE} />
      <circle cx="32" cy="106" r="1.6" fill={BLUE_D} />
      <circle cx="45" cy="106" r="1.6" fill={BLUE_D} />
      <circle cx="55" cy="106" r="1.6" fill={BLUE_D} />
      <circle cx="68" cy="106" r="1.6" fill={BLUE_D} />
    </svg>
  );
}
