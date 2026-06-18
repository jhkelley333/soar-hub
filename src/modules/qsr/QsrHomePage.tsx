// SOAR QSR Learning Platform — admin-gated shell (Milestone 1).
//
// This is the locked-down container the rest of the platform builds into. It
// carries the SOAR QSR brand (distinct from the SOAR Hub chrome) and lays out
// the three surfaces from the spec — Learn / Build / Manage — as a roadmap.
// No fake numbers: real data + flows arrive with Milestones 2+ once the
// production spec and prototypes are in hand.
import { Sparkles, GraduationCap, PencilRuler, BarChart3, Lock } from "lucide-react";
import { qsrBrand } from "./brand";

const SURFACES = [
  {
    title: "Learn",
    icon: GraduationCap,
    blurb: "Mobile, thumb-driven microlessons crew actually want to open — 60-second cards, streaks, daily review.",
    milestone: "Milestone 2 — Learner core + Player",
  },
  {
    title: "Build",
    icon: PencilRuler,
    blurb: "The Course Builder: author on-brand lessons card by card with a live phone preview, then publish.",
    milestone: "Milestone 3 — Authoring",
  },
  {
    title: "Manage",
    icon: BarChart3,
    blurb: "Above-store cockpit: org → region → district → store rollups, assignments, certs, and audit-ready reports.",
    milestone: "Milestone 4 — Manager dashboard",
  },
];

export function QsrHomePage() {
  return (
    <div className="mx-auto max-w-5xl">
      {/* Brand hero */}
      <div className="overflow-hidden rounded-[28px] bg-qsr-azure px-6 py-9 text-white sm:px-10 sm:py-11">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-white/70">
          <Sparkles className="h-4 w-4 text-qsr-gold" /> SOAR QSR · Learning Platform
        </div>
        <h1 className="mt-3 max-w-2xl font-qsr-display text-3xl font-bold leading-[1.1] sm:text-4xl">
          Frontline training that crews actually open.
        </h1>
        <p className="mt-3 max-w-xl font-qsr-ui text-[15px] leading-relaxed text-white/85">
          Microlearning, skills validation, and above-store intelligence for SONIC Drive-In teams —
          built to beat 7taps on experience and Schoox on operations.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-inset ring-white/25">
          <Lock className="h-3.5 w-3.5 text-qsr-gold" /> In development · admin-only
        </div>
      </div>

      {/* Three surfaces — roadmap */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {SURFACES.map((s) => (
          <div key={s.title} className="rounded-2xl border border-border bg-surface p-5">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: `${qsrBrand.azure}14` }}
            >
              <s.icon className="h-5 w-5 text-qsr-azure" />
            </div>
            <h2 className="mt-3 font-qsr-display text-lg font-semibold text-ink">{s.title}</h2>
            <p className="mt-1.5 font-qsr-ui text-sm leading-relaxed text-ink-muted">{s.blurb}</p>
            <span className="mt-3 inline-block rounded-full bg-surface-sunk px-2.5 py-1 text-[11px] font-medium text-ink-subtle">
              {s.milestone}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-6 max-w-2xl text-xs leading-relaxed text-ink-subtle">
        Shell only — Milestone 1. The data model (spec §4), the card{" "}
        <span className="font-qsr-mono">data</span> contract (§5), and the prototype-faithful UI
        land with Milestones 2+ once the production spec and prototype files are attached. This area
        stays admin-only — gated by the <span className="font-qsr-mono">qsr_platform</span> flag —
        until launch.
      </p>
    </div>
  );
}
