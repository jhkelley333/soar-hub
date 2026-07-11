// SLII at Sonic — the situational leadership tool. Development level is
// per TASK, not per person: assess capability + commitment on one specific
// goal/task/skill, then match the leadership style to what that team member
// needs right now. Adapted for Sonic from the SLII framework (Ken Blanchard
// Companies) — content paraphrased for internal coaching use.
import { useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";

// ── The framework, Sonic-ified ────────────────────────────────────────────────
type DKey = "d1" | "d2" | "d3" | "d4";

const LEVELS: Record<DKey, {
  d: string; stage: string; voice: string;
  capability: string; commitment: string;
  looksLike: string[]; needs: string[];
  s: string; style: string; mix: string;
  starters: string[];
}> = {
  d1: {
    d: "D1", stage: "Learning", voice: "“This is new to me.”",
    capability: "Low capability", commitment: "High commitment",
    looksLike: [
      "Brand new to this task — first LTO launch, first close, first time on grill",
      "Excited and eager, willing to take direction",
      "Doesn't yet know what they don't know",
    ],
    needs: [
      "Clear direction on the what and the how — real training, not a hand-wave",
      "A step-by-step plan with check-in points and timelines",
      "Role and priority clarity, examples to copy, feedback on progress",
      "A nod to the skills and energy they already bring",
    ],
    s: "S1", style: "Teaching", mix: "High direction · Low support",
    starters: [
      "Let me show you exactly what good looks like on this — then you run it while I watch.",
      "Here's the step-by-step. We'll check in after the lunch rush.",
    ],
  },
  d2: {
    d: "D2", stage: "Learning", voice: "“This is harder than I thought.”",
    capability: "Low to some capability", commitment: "Low commitment",
    looksLike: [
      "Knows some of it but hit the wall — confused about how to move forward",
      "Frustrated, discouraged, maybe ready to quit the task",
      "Performance is up one shift, down the next",
    ],
    needs: [
      "Someone to actually listen to what's frustrating them",
      "The why behind the task, plus clearer goals and roles",
      "A voice in decisions, reassurance, and more coaching on the how",
    ],
    s: "S2", style: "Teaching", mix: "High direction · High support",
    starters: [
      "You've got more of this than you think — which part is tripping you up?",
      "Here's why we do it this way. Let's run the hard part together again.",
    ],
  },
  d3: {
    d: "D3", stage: "Owning", voice: "“I've got this!”",
    capability: "Moderate to high capability", commitment: "Variable commitment",
    looksLike: [
      "Demonstrated skill — runs it well and contributes",
      "Sometimes hesitant or second-guessing; not always confident",
      "Can drift bored if the task stops being interesting",
    ],
    needs: [
      "Chances to prove the capability they already have",
      "Space to voice doubts, and good questions instead of answers",
      "Reminders of past wins, and ways to keep the work interesting",
    ],
    s: "S3", style: "Coaching", mix: "Low direction · High support",
    starters: [
      "You know this cold — what's your read on it?",
      "You nailed this during spring break rush. What's different this time?",
    ],
  },
  d4: {
    d: "D4", stage: "Advising", voice: "“I can help others with this.”",
    capability: "High capability", commitment: "High commitment",
    looksLike: [
      "Accomplished and consistent — the person others already ask",
      "Self-reliant, justifiably confident, inspires the crew",
    ],
    needs: [
      "Trust and autonomy — get out of the way",
      "Room to innovate, grow, and be visible as the expert",
      "Chances to teach and mentor, and to be valued for it",
    ],
    s: "S4", style: "Encouraging", mix: "Low direction · Low support",
    starters: [
      "This is yours — run it how you see it and tell me what you learn.",
      "Would you train the next new hire on this?",
    ],
  },
};

const CAPABILITY_OPTS: { key: string; label: string; sub: string }[] = [
  { key: "new", label: "Brand new to it", sub: "little or no experience on this task" },
  { key: "some", label: "Some — still learning", sub: "knows pieces, not the whole" },
  { key: "solid", label: "Solid — does it well", sub: "proven on this task" },
  { key: "master", label: "Mastered — could teach it", sub: "the go-to person for it" },
];
const COMMITMENT_OPTS: { key: string; label: string; sub: string }[] = [
  { key: "fired", label: "Fired up", sub: "eager, motivated, all in" },
  { key: "stalled", label: "Frustrated or stalled", sub: "discouraged, overwhelmed" },
  { key: "updown", label: "Up and down", sub: "hesitant or bored some days" },
  { key: "steady", label: "Confident and self-driven", sub: "doesn't need a push" },
];

// Capability sets the half of the path; commitment settles the level.
function resolveD(cap: string, com: string): DKey {
  if (cap === "master") return "d4";
  if (cap === "solid") return com === "steady" ? "d4" : "d3";
  if (cap === "some") return com === "fired" || com === "steady" ? "d3" : "d2";
  return com === "stalled" ? "d2" : "d1";
}

export function SliiSonic({ chip, soft }: { chip: string; soft: string }) {
  const [cap, setCap] = useState<string | null>(null);
  const [com, setCom] = useState<string | null>(null);
  const result = cap && com ? LEVELS[resolveD(cap, com)] : null;

  return (
    <div className="space-y-6">
      {/* the one rule */}
      <div className="rounded-2xl p-4" style={{ background: soft }}>
        <p className="text-[13.5px] leading-relaxed text-heading">
          <strong>Development level is per task, not per person.</strong> Your best closer can be a
          D1 on inventory. Assess capability and commitment on <em>one specific goal, task, or skill</em> —
          then match your style to what they need on it right now.
        </p>
      </div>

      {/* LOA path */}
      <div>
        <SectionTitle chip={chip}>The development path</SectionTitle>
        <div className="flex items-center gap-1.5">
          {(["Learning", "Owning", "Advising"] as const).map((stage, i) => (
            <div key={stage} className="flex flex-1 items-center gap-1.5">
              <div className="flex-1 rounded-xl border border-border bg-surface px-2 py-2.5 text-center">
                <div className="text-[12px] font-bold text-heading">{stage}</div>
                <div className="mt-0.5 text-[10px] leading-tight text-ink-subtle">
                  {stage === "Learning" ? "“This is new to me”" : stage === "Owning" ? "“I've got this!”" : "“I can help others”"}
                </div>
              </div>
              {i < 2 && <span className="text-ink-subtle">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* matcher */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between">
          <SectionTitle chip={chip}>Match your style</SectionTitle>
          {(cap || com) && (
            <button onClick={() => { setCap(null); setCom(null); }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-ink-subtle hover:text-heading">
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>
        <p className="mb-3 text-[13px] text-ink-muted">Think of one team member and one specific task.</p>

        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">1 · How capable are they on this task?</div>
        <div className="grid grid-cols-2 gap-1.5">
          {CAPABILITY_OPTS.map((o) => (
            <PickBtn key={o.key} active={cap === o.key} chip={chip} soft={soft} label={o.label} sub={o.sub} onClick={() => setCap(o.key)} />
          ))}
        </div>

        <div className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">2 · How's their motivation and confidence on it?</div>
        <div className="grid grid-cols-2 gap-1.5">
          {COMMITMENT_OPTS.map((o) => (
            <PickBtn key={o.key} active={com === o.key} chip={chip} soft={soft} label={o.label} sub={o.sub} onClick={() => setCom(o.key)} />
          ))}
        </div>

        {result && (
          <div className="mt-4 rounded-xl p-4" style={{ background: soft }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ background: chip }}>
                {result.d} {result.stage}
              </span>
              <span className="text-sm text-ink-muted">{result.voice}</span>
            </div>
            <div className="mt-3 text-lg font-bold text-heading">
              Lead with {result.s} — {result.style}
            </div>
            <div className="text-[12.5px] font-semibold" style={{ color: chip }}>{result.mix}</div>
            <div className="mt-3 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">What they need from you</div>
            <ul className="mt-1 space-y-1">
              {result.needs.map((n, i) => (
                <li key={i} className="flex gap-2 text-[13.5px] leading-snug text-heading">
                  <span style={{ color: chip }}>•</span>{n}
                </li>
              ))}
            </ul>
            <div className="mt-3 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Openers</div>
            {result.starters.map((q, i) => (
              <p key={i} className="mt-1 rounded-lg bg-white/70 px-3 py-2 text-[13.5px] italic leading-snug text-heading">“{q}”</p>
            ))}
          </div>
        )}
      </div>

      {/* skill 1 — Aligning */}
      <Fold title="Skill 1 · Aligning" sub="Agree on what good looks like" chip={chip}>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          Before anyone can be coached on a task, you both have to agree on what's expected. Set the
          goal, task, or skill <strong className="text-heading">SMART</strong>:
        </p>
        <dl className="mt-2 space-y-1.5">
          {[
            ["Specific", "What exactly is it? What does a good job look like, and by when?"],
            ["Motivating", "Does it matter to them? Will working on it build them up or drain them?"],
            ["Attainable", "Realistic and within their control?"],
            ["Relevant", "Does it matter to the store and the company? Is it a real priority?"],
            ["Trackable", "How will you both see progress and results?"],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2.5 text-[13.5px]">
              <dt className="w-6 shrink-0 text-center font-bold" style={{ color: chip }}>{k[0]}</dt>
              <dd className="leading-snug text-heading"><strong>{k}</strong> — <span className="text-ink-muted">{v}</span></dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 rounded-xl bg-surface-sunk p-3 text-[13px] leading-relaxed text-ink-muted">
          <strong className="text-heading">Write it in STRAM order:</strong> put the <strong>S</strong>pecific
          and <strong>T</strong>rackable parts in the written goal; talk through <strong>R</strong>elevant,{" "}
          <strong>A</strong>ttainable, and <strong>M</strong>otivating together without writing them in.
          Goals read as <em>achieves-outcome-when</em>; tasks and skills read as <em>performs-activity-how-and-when</em>.
        </div>
      </Fold>

      {/* skill 2 — Assessing */}
      <Fold title="Skill 2 · Assessing" sub="Gauge capability + commitment together" chip={chip}>
        <p className="mb-3 text-[13.5px] leading-relaxed text-ink-muted">
          <strong className="text-heading">Capability</strong> = demonstrated knowledge and skill on this task.{" "}
          <strong className="text-heading">Commitment</strong> = motivation and confidence on it. Assess{" "}
          <em>with</em> the team member, not about them.
        </p>
        <div className="space-y-2">
          {(Object.keys(LEVELS) as DKey[]).map((k) => {
            const l = LEVELS[k];
            return (
              <div key={k} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: chip }}>{l.d}</span>
                  <span className="text-sm font-bold text-heading">{l.stage}</span>
                  <span className="text-xs text-ink-subtle">{l.capability} · {l.commitment}</span>
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {l.looksLike.map((x, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink-muted"><span style={{ color: chip }}>•</span>{x}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Fold>

      {/* skill 3 — Matching */}
      <Fold title="Skill 3 · Matching" sub="Flex your style to what they need" chip={chip}>
        <div className="mb-3 overflow-hidden rounded-xl border border-border">
          {(Object.keys(LEVELS) as DKey[]).map((k, i) => {
            const l = LEVELS[k];
            return (
              <div key={k} className={cn("flex items-center gap-2 px-3 py-2 text-[13px]", i % 2 === 0 ? "bg-surface" : "bg-surface-sunk")}>
                <span className="w-24 font-bold text-heading">{l.d} {l.stage}</span>
                <span className="text-ink-subtle">→</span>
                <span className="flex-1 font-semibold" style={{ color: chip }}>{l.s} {l.style}</span>
                <span className="text-[11.5px] text-ink-subtle">{l.mix}</span>
              </div>
            );
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: chip }}>Directive behaviors</div>
            <div className="text-[11.5px] text-ink-subtle">shape the what, how, and when</div>
            <ul className="mt-1.5 space-y-0.5 text-[13px] leading-snug text-ink-muted">
              <li><strong className="text-heading">Set SMART goals</strong> — the #1 directive move</li>
              <li><strong className="text-heading">Show and tell how</strong> — #2</li>
              <li>Set timelines and priorities</li>
              <li>Clarify roles, build action plans</li>
              <li>Watch performance and give feedback</li>
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: chip }}>Supportive behaviors</div>
            <div className="text-[11.5px] text-ink-subtle">build trust, motivation, and confidence</div>
            <ul className="mt-1.5 space-y-0.5 text-[13px] leading-snug text-ink-muted">
              <li><strong className="text-heading">Listen</strong> — the #1 supportive move</li>
              <li><strong className="text-heading">Help them solve it themselves</strong> — #2</li>
              <li>Ask for input, explain the why</li>
              <li>Acknowledge and encourage</li>
              <li>Share context about the business — and yourself</li>
            </ul>
          </div>
        </div>
      </Fold>

      {/* beliefs footer */}
      <div className="rounded-2xl border border-border bg-surface p-4 text-[13px] leading-relaxed text-ink-muted">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: chip }}>What we believe at Sonic</div>
        Team members own their development and are accountable for their performance. Leaders set clear
        expectations and build the environment where people can do their best work — and move from{" "}
        <strong className="text-heading">Learning</strong> to <strong className="text-heading">Owning</strong> to{" "}
        <strong className="text-heading">Advising</strong>.
      </div>
    </div>
  );
}

function PickBtn({ active, chip, soft, label, sub, onClick }: {
  active: boolean; chip: string; soft: string; label: string; sub: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={cn("rounded-xl border px-3 py-2 text-left transition", active ? "border-transparent" : "border-border bg-surface hover:border-border-strong")}
      style={active ? { background: soft, boxShadow: `inset 0 0 0 2px ${chip}` } : undefined}>
      <div className="text-[13px] font-semibold leading-tight text-heading">{label}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-ink-subtle">{sub}</div>
    </button>
  );
}

function SectionTitle({ chip, children }: { chip: string; children: React.ReactNode }) {
  return <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-wider" style={{ color: chip }}>{children}</div>;
}

function Fold({ title, sub, chip, children }: { title: string; sub: string; chip: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-bold text-heading">{title}</div>
          <div className="text-[12px] text-ink-subtle">{sub}</div>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-subtle transition-transform", open && "rotate-180")} style={open ? { color: chip } : undefined} />
      </button>
      {open && <div className="border-t border-border px-4 py-3.5">{children}</div>}
    </div>
  );
}
