import { Check, AlertTriangle } from "lucide-react";
import {
  CONSTRUCTS,
  familyOf,
  NATURAL_VS_ADAPTED,
  type CiPattern,
  type Signature,
  type SignatureLevel,
} from "./patterns";

// Family hue → chip/accent classes. Kept here so the reference page and the
// trait-chip drawer render a pattern identically.
export const FAMILY_CHIP: Record<string, string> = {
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  zinc: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

const LEVEL_POS: Record<SignatureLevel, number> = {
  low: 14,
  "mid-low": 32,
  mid: 50,
  "mid-high": 68,
  high: 86,
  elevated: 92,
  "n/a": 50,
};
const LEVEL_LABEL: Record<SignatureLevel, string> = {
  low: "Low",
  "mid-low": "Mid-low",
  mid: "Mid",
  "mid-high": "Mid-high",
  high: "High",
  elevated: "Elevated",
  "n/a": "—",
};

function SignatureRow({ signature }: { signature: Signature }) {
  return (
    <div className="space-y-2">
      {CONSTRUCTS.filter((c) => c.code !== "EU").map((c) => {
        const level = signature[c.code as keyof Signature];
        const pos = LEVEL_POS[level];
        const relative = c.kind === "relative";
        return (
          <div key={c.code} className="grid grid-cols-[2rem_1fr_5rem] items-center gap-2">
            <span className="font-mono text-xs font-semibold text-zinc-500">{c.code}</span>
            <div className="relative h-2 rounded-full bg-zinc-100">
              {/* norm line for relative traits (A/B/C/D) */}
              {relative && (
                <span className="absolute top-[-3px] h-[14px] w-px bg-zinc-300" style={{ left: "50%" }} />
              )}
              <span
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-white"
                style={{ left: `${pos}%` }}
              />
            </div>
            <span className="text-right text-[11px] font-medium text-zinc-500">
              {LEVEL_LABEL[level]}
            </span>
          </div>
        );
      })}
      <p className="pt-1 text-[11px] text-zinc-400">
        A/B/C/D read against the norm line (center); L/I are absolute 0–10.
      </p>
    </div>
  );
}

export function PatternDetail({ pattern }: { pattern: CiPattern }) {
  const fam = familyOf(pattern.family);
  const chip = fam ? FAMILY_CHIP[fam.hue] : FAMILY_CHIP.zinc;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-tight text-heading">{pattern.name}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${chip}`}>
            {fam?.name ?? pattern.family}
          </span>
          {pattern.isFlag && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
              Data-quality flag
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{pattern.essence}</p>
      </div>

      {pattern.signature && (
        <div className="rounded-lg border border-border bg-surface-muted/50 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Trait signature
          </p>
          <SignatureRow signature={pattern.signature} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pattern.strengths.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Strengths
            </p>
            <ul className="space-y-1">
              {pattern.strengths.map((s) => (
                <li key={s} className="text-sm text-ink-muted">• {s}</li>
              ))}
            </ul>
          </div>
        )}
        {pattern.watchouts.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
              {pattern.isFlag ? "How to handle" : "Watch-outs"}
            </p>
            <ul className="space-y-1">
              {pattern.watchouts.map((w) => (
                <li key={w} className="text-sm text-ink-muted">• {w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {pattern.style && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Working with them
          </p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StyleItem label="Communication" value={pattern.style.communication} />
            <StyleItem label="As a manager" value={pattern.style.management} />
            <StyleItem label="Best environment" value={pattern.style.environment} />
            <StyleItem label="Motivators" value={pattern.style.motivators.join(" · ")} />
          </dl>
        </div>
      )}

      <p className="rounded-lg bg-accent/5 px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
        <span className="font-semibold text-heading">Defaults, not ceiling.</span>{" "}
        Traits describe natural wiring, not ability. Self-aware people routinely outperform their
        "natural fit" with compensating structure — frame gaps as coaching paths, never a verdict.
      </p>

      <p className="text-[11px] leading-relaxed text-zinc-400">
        <span className="font-semibold">Natural vs. adapted:</span> {NATURAL_VS_ADAPTED}
      </p>
    </div>
  );
}

function StyleItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-muted">{value}</dd>
    </div>
  );
}
