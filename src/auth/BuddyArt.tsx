// Shared SVG art for the SOAR roller-skating buddy. Used by the landing-page
// mascot (RollerBuddy, with cursor-tracking pupils) and the hidden runner
// game (RollerGame, static facing-right). Pupils can be offset to "look" at a
// pointer; default is centered.
export function BuddyArt({
  pupil = { x: 0, y: 0 },
  className,
}: {
  pupil?: { x: number; y: number };
  className?: string;
}) {
  return (
    <svg viewBox="0 0 100 120" className={className}>
      {/* shadow */}
      <ellipse cx="50" cy="115" rx="30" ry="3" fill="rgba(0,0,0,0.18)" />

      {/* arms */}
      <path d="M22 62 Q10 72 18 84" stroke="oklch(0.55 0.18 250)" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M78 62 Q90 72 82 84" stroke="oklch(0.55 0.18 250)" strokeWidth="7" strokeLinecap="round" fill="none" />

      {/* head */}
      <circle cx="50" cy="40" r="32" fill="oklch(0.62 0.22 25)" />
      {/* eye whites */}
      <ellipse cx="40" cy="36" rx="7" ry="6" fill="oklch(0.78 0.14 240)" />
      <ellipse cx="60" cy="36" rx="7" ry="6" fill="oklch(0.78 0.14 240)" />
      {/* pupils */}
      <circle cx={40 + pupil.x} cy={36 + pupil.y} r="2.5" fill="oklch(0.2 0.05 250)" />
      <circle cx={60 + pupil.x} cy={36 + pupil.y} r="2.5" fill="oklch(0.2 0.05 250)" />
      {/* smile */}
      <path d="M40 50 Q50 60 60 50 Q55 56 50 56 Q45 56 40 50 Z" fill="oklch(0.78 0.14 240)" />

      {/* skates body */}
      <rect x="28" y="80" width="18" height="14" rx="4" fill="oklch(0.55 0.18 250)" />
      <rect x="54" y="80" width="18" height="14" rx="4" fill="oklch(0.55 0.18 250)" />
      {/* skate plates */}
      <rect x="26" y="94" width="22" height="4" rx="2" fill="oklch(0.45 0.18 250)" />
      <rect x="52" y="94" width="22" height="4" rx="2" fill="oklch(0.45 0.18 250)" />
      {/* wheels */}
      <circle cx="30" cy="104" r="5" fill="oklch(0.55 0.18 250)" />
      <circle cx="44" cy="104" r="5" fill="oklch(0.55 0.18 250)" />
      <circle cx="56" cy="104" r="5" fill="oklch(0.55 0.18 250)" />
      <circle cx="70" cy="104" r="5" fill="oklch(0.55 0.18 250)" />
      <circle cx="30" cy="104" r="1.5" fill="oklch(0.3 0.1 250)" />
      <circle cx="44" cy="104" r="1.5" fill="oklch(0.3 0.1 250)" />
      <circle cx="56" cy="104" r="1.5" fill="oklch(0.3 0.1 250)" />
      <circle cx="70" cy="104" r="1.5" fill="oklch(0.3 0.1 250)" />
    </svg>
  );
}
