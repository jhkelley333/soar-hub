// Coaching Tool Kit — tool detail. A shared shell (back bar → hero → body)
// that sets the tool's accent and renders the right body. Several bodies are
// interactive: tap-to-copy questions, the accountability dial, the readiness
// walk (persisted checklist), the feedback builder, and the box breather.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Copy, Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/shared/ui/Toaster";
import { Segmented } from "@/shared/ui/Segmented";
import { chipVars, TOOL_BY_ID, type CoachTool, type ToolId } from "./types";
import { useCoachingStore } from "./storage";
import { AccountabilityDial } from "./widgets/AccountabilityDial";
import { BoxBreather } from "./widgets/BoxBreather";
import { WhatWhatWhy } from "./widgets/WhatWhatWhy";

const FAV = "#E06A55";

async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
  } catch { /* give up silently */ }
}

export function ToolDetailPage() {
  const { toolId } = useParams<{ toolId: ToolId }>();
  const nav = useNavigate();
  const tool = toolId ? TOOL_BY_ID[toolId] : undefined;
  const { favorites, toggleFavorite } = useCoachingStore();

  if (!tool) {
    return (
      <div className="mx-auto max-w-2xl">
        <button onClick={() => nav("/coaching")} className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-heading">
          <ArrowLeft className="h-4 w-4" /> Tool Kit
        </button>
        <p className="mt-6 text-sm text-ink-muted">That tool doesn't exist.</p>
      </div>
    );
  }

  const { chip, soft } = chipVars(tool.hue);
  const fav = favorites.includes(tool.id);
  const Icon = tool.icon;

  return (
    <div className="mx-auto max-w-2xl pb-12">
      {/* back bar */}
      <div className="mb-1 flex items-center justify-between">
        <button onClick={() => nav("/coaching")} className="inline-flex items-center gap-1 rounded-lg px-1 py-1.5 text-[15px] font-semibold text-heading hover:bg-surface-sunk">
          <ArrowLeft className="h-5 w-5" /> Tool Kit
        </button>
        <button onClick={() => toggleFavorite(tool.id)} aria-label={fav ? "Remove favorite" : "Add favorite"}
          className="grid h-9 w-9 place-items-center rounded-full text-ink-subtle hover:bg-surface-sunk">
          <Heart className={cn("h-5 w-5", fav && "fill-current")} style={fav ? { color: FAV } : undefined} strokeWidth={2} />
        </button>
      </div>

      {/* hero */}
      <div className="mb-5 pt-1">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl shadow-card" style={{ background: soft, color: chip }}>
          <Icon className="h-7 w-7" strokeWidth={1.9} />
        </span>
        <div className="font-mono text-[11px] font-bold uppercase tracking-wider" style={{ color: chip }}>{tool.eyebrow}</div>
        <h1 className="mt-2 text-[27px] font-bold leading-tight tracking-tight text-heading">{tool.title}</h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">{tool.intro}</p>
        {tool.source && (
          <div className="mt-3.5 flex items-center gap-2 font-mono text-[11px] text-ink-subtle">
            <span className="h-px w-3.5 bg-border-strong" />{tool.source}
          </div>
        )}
      </div>

      {/* body */}
      <Body tool={tool} chip={chip} soft={soft} />
    </div>
  );
}

function Body({ tool, chip, soft }: { tool: CoachTool; chip: string; soft: string }) {
  switch (tool.id) {
    case "improve": return <Improve chip={chip} soft={soft} />;
    case "habit": return <Habit chip={chip} soft={soft} />;
    case "telling": return <Telling chip={chip} soft={soft} />;
    case "dial": return <Dial />;
    case "walk": return <Walk chip={chip} soft={soft} />;
    case "mindfulness": return <Mindfulness chip={chip} soft={soft} />;
  }
}

// ── shared bits ─────────────────────────────────────────────────────────────
function QCard({ n, eyebrow, q, chip, soft }: { n?: number; eyebrow: string; q: string; chip: string; soft: string }) {
  const toast = useToast();
  return (
    <button onClick={async () => { await copyText(q); toast.push("Copied to clipboard", "success"); }}
      className="relative w-full rounded-2xl border border-border bg-surface p-4 pl-[18px] text-left shadow-card transition active:scale-[.99]"
      style={{ borderLeftWidth: 4, borderLeftColor: chip }}>
      <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider" style={{ color: chip }}>
        {n != null && <span className="grid h-5 w-5 place-items-center rounded-full text-[10px]" style={{ background: soft }}>{n}</span>}
        {eyebrow}
      </div>
      <div className="mt-2.5 pr-12 text-[18px] font-semibold leading-snug tracking-tight text-heading">{q}</div>
      <span className="absolute bottom-3 right-3.5 flex items-center gap-1 font-mono text-[10px] text-ink-subtle opacity-70"><Copy className="h-3 w-3" /> copy</span>
    </button>
  );
}

function BodyHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 mt-7 flex items-center gap-2.5 first:mt-1">
      <h2 className="text-[15px] font-bold tracking-tight text-heading">{children}</h2>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function Callout({ eyebrow, children, chip, soft }: { eyebrow: string; children: React.ReactNode; chip: string; soft: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: soft, border: `1px solid color-mix(in srgb, ${chip} 22%, transparent)` }}>
      <div className="font-mono text-[11px] font-bold uppercase tracking-wider" style={{ color: chip }}>{eyebrow}</div>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink">{children}</p>
    </div>
  );
}

// ── A. Coaching to Improve ───────────────────────────────────────────────────
const IMPROVE_QS = [
  "What's the current plan?", "What's the expected outcome?", "Do we see the plan in action?",
  "What is the gap?", "What are the obstacles?", "What is the next step?",
];
const PDCA = [
  ["Plan", "Set the target condition"], ["Do", "Run the plan in real work"],
  ["Check", "Compare actual to expected"], ["Act", "Adjust, then cycle again"],
];
function Improve({ chip, soft }: { chip: string; soft: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      {IMPROVE_QS.map((q, i) => <QCard key={i} n={i + 1} eyebrow="Question" q={q} chip={chip} soft={soft} />)}
      <div className="mt-3" />
      <Callout eyebrow="Result" chip={chip} soft={soft}>
        Achieve the goal — a measurable target of what should, or needs to, be happening.
      </Callout>
      <BodyHeading>The rhythm</BodyHeading>
      <div className="grid grid-cols-2 gap-2.5">
        {PDCA.map(([s, d]) => (
          <div key={s} className="rounded-xl border border-border bg-surface p-3.5 shadow-card">
            <div className="text-[13px] font-extrabold uppercase tracking-wide" style={{ color: chip }}>{s}</div>
            <div className="mt-1 text-[12px] leading-snug text-ink-muted">{d}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[12.5px] leading-relaxed text-ink-muted">Plan → Do → Check → Act, on repeat — small loops that build commitment and skill.</p>
    </div>
  );
}

// ── B. The Coaching Habit ────────────────────────────────────────────────────
const HABIT_QS: [string, string][] = [
  ["Kick-start", "What's on your mind?"],
  ["A.W.E.", "And what else?"],
  ["Focus", "What's the real challenge here for you?"],
  ["Foundation", "What do you want?"],
  ["Lazy", "How can I help?"],
  ["Strategic", "If you say yes to this, what must you say no to?"],
  ["Learning", "What was most useful or valuable to you?"],
];
function Habit({ chip, soft }: { chip: string; soft: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      {HABIT_QS.map(([type, q], i) => <QCard key={i} eyebrow={type} q={q} chip={chip} soft={soft} />)}
      <p className="mt-2 text-center font-mono text-[10.5px] tracking-wide text-ink-subtle">Tap any question to copy it.</p>
    </div>
  );
}

// ── C. Out of the Habit of Telling ───────────────────────────────────────────
const PRACTICES: { title: string; body: string; ask?: string }[] = [
  { title: "Clarity Pause", body: "Before you respond, connect with your intention. What outcome are you actually after?" },
  { title: "Don't be an ownership thief", body: "Resist grabbing the problem.", ask: "What are your thoughts?" },
  { title: "Assess question quality", body: "Keep questions open.", ask: 'Start with "What" or "How."' },
];
function Telling({ chip, soft }: { chip: string; soft: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      {PRACTICES.map((p, i) => (
        <div key={i} className="flex items-start gap-3.5 rounded-2xl border border-border bg-surface p-4 shadow-card">
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] text-[15px] font-bold" style={{ background: soft, color: chip }}>{i + 1}</span>
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold tracking-tight text-heading">{p.title}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{p.body}</p>
            {p.ask && <span className="mt-2 inline-block text-[14.5px] font-medium italic" style={{ color: chip }}>{p.ask}</span>}
          </div>
        </div>
      ))}
      <BodyHeading>When you must give feedback</BodyHeading>
      <p className="px-1 text-[13px] leading-relaxed text-ink-muted">
        When there's a standards gap, the <b className="font-semibold text-heading">What / What / Why</b> frame lets you be direct while still helping your partner improve. Fill it in:
      </p>
      <div className="mt-3"><WhatWhatWhy chip={chip} soft={soft} /></div>
    </div>
  );
}

// ── D. The Accountability Dial ───────────────────────────────────────────────
function Dial() {
  return (
    <div>
      <p className="mb-4 text-center text-[13px] leading-relaxed text-ink-muted">Turn the dial up only as far as you need to. Start light — escalate one click at a time.</p>
      <AccountabilityDial />
    </div>
  );
}

// ── E. The Sonic Readiness Walk ──────────────────────────────────────────────
const WALK_STEPS: { title: string; sub: string; tag: string }[] = [
  { title: "Scan the lot for energy", sub: "Stalls, patio, entry.", tag: "1st position" },
  { title: "Walk the drive-in for the Sonic Experience", sub: "Stalls, patio, and drive thru.", tag: "2nd position" },
  { title: "Watch team actions", sub: "Are they creating the experience?", tag: "3rd position" },
  { title: "Coach in the moment", sub: "Lead shoulder-to-shoulder to build great habits.", tag: "3rd + 1st" },
  { title: "Review overall operations", sub: "Through the Lens of Excellence — does the store reflect our standards right now?", tag: "3rd · 1st · 2nd" },
];
const POSITIONS: { n: number; hue: number; title: string; line: string; sub: string }[] = [
  { n: 1, hue: 200, title: "1st Position", line: "The way I see the world.", sub: "My subjective experience — my story and my reality." },
  { n: 2, hue: 250, title: "2nd Position", line: "The way you see the world.", sub: "Your subjective experience — your story and your reality." },
  { n: 3, hue: 150, title: "3rd · The Observer", line: "The way a neutral, objective witness would see it.", sub: "Step out. No story, just what is." },
];
function Walk({ chip, soft }: { chip: string; soft: string }) {
  const [tab, setTab] = useState<"walk" | "positions">("walk");
  const { walkDone, toggleWalkStep, resetWalk } = useCoachingStore();
  const done = walkDone.length;

  return (
    <div>
      <Segmented
        className="mb-4 flex w-full"
        options={[{ value: "walk", label: "The Walk" }, { value: "positions", label: "Perceptual Positions" }]}
        value={tab} onChange={setTab} />

      {tab === "walk" ? (
        <div className="flex flex-col gap-2.5">
          <div className="rounded-2xl bg-midnight-900 p-5 text-frost-soft">
            <div className="font-mono text-[11px] uppercase tracking-wider text-white/55">The Lens of Excellence</div>
            <p className="mt-2.5 text-lg font-medium leading-snug tracking-tight">
              "Do the very best you can, with the tools and team you have — <span style={{ color: "#9FD9B8" }}>right now</span>."
            </p>
          </div>

          <div className="my-1 flex items-center gap-3">
            <span className="font-mono text-[12px] font-bold text-ink-muted">{done}/5</span>
            <div className="h-[7px] flex-1 overflow-hidden rounded-full border border-border bg-surface-sunk">
              <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${(done / 5) * 100}%`, background: chip }} />
            </div>
            {done > 0 && <button onClick={resetWalk} className="text-[13px] font-semibold" style={{ color: chip }}>Reset</button>}
          </div>

          {WALK_STEPS.map((s, i) => {
            const isDone = walkDone.includes(i);
            return (
              <button key={i} onClick={() => toggleWalkStep(i)}
                className="flex w-full items-start gap-3 rounded-2xl border bg-surface p-4 text-left transition active:scale-[.99]"
                style={isDone ? { borderColor: chip, background: soft } : { borderColor: "var(--color-border)" }}>
                <span className="mt-0.5 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg border-2"
                  style={isDone ? { background: chip, borderColor: chip, color: "#fff" } : { borderColor: "var(--color-border-strong)" }}>
                  {isDone && <Check className="h-4 w-4" strokeWidth={3} />}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15.5px] font-semibold tracking-tight text-heading">{i + 1}. {s.title}</h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{s.sub}</p>
                  <span className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide" style={{ background: soft, color: chip }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: chip }} />{s.tag}
                  </span>
                </div>
              </button>
            );
          })}
          {done === 5 && <p className="mt-2 text-center text-[13px] font-bold" style={{ color: chip }}>Walk complete — nice work.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="px-1 text-[13px] leading-relaxed text-ink-muted">Coach from all three points of view. Move between positions to lead with both empathy and objectivity.</p>
          {POSITIONS.map((p) => {
            const pv = chipVars(p.hue);
            return (
              <div key={p.n} className="rounded-2xl border border-border bg-surface p-4 shadow-card" style={{ borderLeftWidth: 4, borderLeftColor: pv.chip }}>
                <div className="text-[46px] font-extrabold leading-none tracking-tight" style={{ color: pv.chip }}>{p.n}</div>
                <h3 className="mt-2.5 text-[17px] font-semibold tracking-tight text-heading">{p.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{p.line}</p>
                <p className="mt-1.5 text-[12.5px] italic text-ink-subtle">{p.sub}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── F. Practice Mindfulness ──────────────────────────────────────────────────
function Mindfulness({ chip, soft }: { chip: string; soft: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <Callout eyebrow="Clarity Pause" chip={chip} soft={soft}>
        Taking a few moments before responding to a question or situation gives you time to reflect, clear your mind, and be fully present.
      </Callout>
      <BodyHeading>Box breathing</BodyHeading>
      <p className="px-1 text-[12.5px] leading-relaxed text-ink-muted">Slow, even breaths — inhale 4, hold 4, exhale 4, hold 4. Follow the orb.</p>
      <BoxBreather chip={chip} />
    </div>
  );
}
