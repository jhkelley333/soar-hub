// Ranker — execution score ring. Renders an SVG circular progress with
// the score in the middle. null score (no data) renders an empty ring
// with "—" instead of "0", so we don't confuse "we have no inputs" with
// "every input scored zero".

interface Props {
  score: number | null;
  size?: number;
}

function scoreClass(score: number): string {
  if (score >= 75) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

export function ScoreRing({ score, size = 90 }: Props) {
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const hasScore = score !== null;
  const dash = hasScore ? (score! / 100) * circumference : 0;
  const colorClass = hasScore ? scoreClass(score!) : "text-zinc-300";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={colorClass}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgb(228 228 231)"
        strokeWidth={5}
      />
      {hasScore && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={5}
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text
        x="50%"
        y="48%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="ui-sans-serif, system-ui"
        fontSize={size * 0.26}
        fontWeight={700}
      >
        {hasScore ? String(score) : "—"}
      </text>
      <text
        x="50%"
        y="70%"
        dominantBaseline="middle"
        textAnchor="middle"
        fill="rgb(113 113 122)"
        fontFamily="ui-sans-serif, system-ui"
        fontSize={size * 0.1}
        fontWeight={500}
        letterSpacing="0.1em"
      >
        SCORE
      </text>
    </svg>
  );
}
