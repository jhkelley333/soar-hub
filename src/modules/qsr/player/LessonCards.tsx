// SOAR QSR — the 8 lesson card renderers. Behaviorally faithful to the
// prototype spec (PrimaryBtn press states, quiz correct/wrong, reveal
// tap-to-open, poll result bars, confetti done). Server is the source of
// truth: quiz scoring, poll results, and video gating come from the API, never
// the client. Reconcile exact pixels against cards.jsx when it's attached.
import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { Check, X, Play, Lock } from "lucide-react";
import { answerQuiz, votePoll, recordCardProgress, completeLesson } from "../api";
import type {
  LessonCard, IntroData, StepsData, ImageData, VideoData, QuizData, RevealData, PollData, DoneData,
} from "../types";

export function PrimaryBtn({
  children, onClick, disabled, tone = "azure",
}: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: "azure" | "white" }) {
  const base =
    "w-full rounded-full px-5 py-3.5 text-center font-qsr-ui text-[15px] font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";
  const tones = tone === "white"
    ? "bg-white text-qsr-azure hover:bg-white/90"
    : "bg-qsr-azure text-white hover:brightness-110";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${tones}`}>
      {children}
    </button>
  );
}

const Kicker = ({ children, light }: { children?: React.ReactNode; light?: boolean }) =>
  children ? (
    <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
      light ? "bg-white/15 text-white" : "bg-qsr-azure/10 text-qsr-azure"
    }`}>{children}</span>
  ) : null;

type CardProps = { card: LessonCard; onAdvance: () => void; onPoints: (delta: number) => void };

// ── intro ────────────────────────────────────────────────────────────────
export function IntroCard({ card, onAdvance }: CardProps) {
  const d = card.data as IntroData;
  return (
    <div className="flex h-full flex-col justify-between bg-qsr-azure p-7 text-white">
      <div className="pt-6">
        <Kicker light>{d.kicker}</Kicker>
        <h1 className="mt-4 font-qsr-display text-[34px] font-bold leading-[1.05]">{d.title}</h1>
        {d.body && <p className="mt-3 font-qsr-ui text-[15px] leading-relaxed text-white/85">{d.body}</p>}
        {d.meta?.length ? (
          <div className="mt-7 flex gap-7">
            {d.meta.map((m, i) => (
              <div key={i}>
                <div className="font-qsr-display text-2xl font-bold">{m.v}</div>
                <div className="font-qsr-ui text-[11px] uppercase tracking-wide text-white/70">{m.k}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <PrimaryBtn tone="white" onClick={onAdvance}>Start lesson ▸</PrimaryBtn>
    </div>
  );
}

// ── steps ────────────────────────────────────────────────────────────────
export function StepsCard({ card, onAdvance }: CardProps) {
  const d = card.data as StepsData;
  return (
    <div className="flex h-full flex-col justify-between bg-white p-7">
      <div className="overflow-y-auto pt-4">
        <Kicker>{d.kicker}</Kicker>
        <h2 className="mt-3 font-qsr-display text-2xl font-bold text-ink">{d.title}</h2>
        <ol className="mt-5 space-y-3">
          {d.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-qsr-azure font-qsr-mono text-xs font-bold text-white">{i + 1}</span>
              <div>
                <div className="font-qsr-ui text-[15px] font-semibold text-ink">{s.t}</div>
                {s.d && <div className="font-qsr-ui text-sm text-ink-muted">{s.d}</div>}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <PrimaryBtn onClick={onAdvance}>Got it ▸</PrimaryBtn>
    </div>
  );
}

// ── image ────────────────────────────────────────────────────────────────
export function ImageCard({ card, onAdvance }: CardProps) {
  const d = card.data as ImageData;
  return (
    <div className="flex h-full flex-col justify-between bg-white p-7">
      <div className="pt-4">
        <Kicker>{d.kicker}</Kicker>
        <h2 className="mt-3 font-qsr-display text-2xl font-bold text-ink">{d.title}</h2>
        <div className="mt-4 aspect-[4/3] overflow-hidden rounded-2xl bg-surface-sunk">
          {d.imageUrl ? (
            <img src={d.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center font-qsr-ui text-xs text-ink-subtle">
              Image uploads in the media milestone
            </div>
          )}
        </div>
        {d.body && <p className="mt-4 font-qsr-ui text-[15px] leading-relaxed text-ink-muted">{d.body}</p>}
      </div>
      <PrimaryBtn onClick={onAdvance}>Continue ▸</PrimaryBtn>
    </div>
  );
}

// ── video (server-gated; simulated playback until Mux/M5) ──────────────────
export function VideoCard({ card, onAdvance }: CardProps) {
  const d = card.data as VideoData;
  const [pct, setPct] = useState(card.progress?.watched_pct ?? 0);
  const [passable, setPassable] = useState(card.progress?.state === "passed");
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const play = () => {
    if (playing || passable) return;
    setPlaying(true);
    timer.current = window.setInterval(async () => {
      setPct((p) => {
        const next = Math.min(1, +(p + 0.1).toFixed(2));
        // Report to the server; it alone decides when the card is passable.
        recordCardProgress(card.id, "seen", next).then((r) => { if (r.passable) setPassable(true); }).catch(() => {});
        if (next >= 1 && timer.current) { window.clearInterval(timer.current); setPlaying(false); }
        return next;
      });
    }, 600);
  };

  return (
    <div className="flex h-full flex-col justify-between bg-midnight-950 p-7 text-white">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Kicker light>{d.kicker}</Kicker>
        <h2 className="mt-3 font-qsr-display text-2xl font-bold">{d.title}</h2>
        {d.body && <p className="mt-2 font-qsr-ui text-sm text-white/70">{d.body}</p>}
        <button
          type="button" onClick={play}
          className="mt-7 flex h-16 w-16 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30 transition active:scale-95"
        >
          <Play className="h-7 w-7 fill-white text-white" />
        </button>
        <div className="mt-5 h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
          <div className="h-full bg-qsr-gold transition-all" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
        <p className="mt-3 font-qsr-mono text-[11px] text-white/50">
          Simulated playback until Mux (Milestone 5) · gate ≥ {Math.round((d.threshold ?? 0.9) * 100)}%
        </p>
      </div>
      <PrimaryBtn tone="white" onClick={onAdvance} disabled={!passable}>
        {passable ? "Continue ▸" : "Watch to continue"}
      </PrimaryBtn>
    </div>
  );
}

// ── quiz (server-scored) ───────────────────────────────────────────────────
export function QuizCard({ card, onAdvance, onPoints }: CardProps) {
  const d = card.data as QuizData;
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ correct: boolean; answer: number; explain: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (i: number) => {
    if (result || busy) return;
    setSelected(i); setBusy(true);
    try {
      const r = await answerQuiz(card.id, i);
      setResult({ correct: r.correct, answer: r.answer, explain: r.explain });
      onPoints(r.pointsAwarded);
    } finally { setBusy(false); }
  };

  const optionClass = (i: number) => {
    if (!result) return "border-border bg-white text-ink hover:border-qsr-azure";
    if (i === result.answer) return "border-success bg-success/10 text-ink";
    if (i === selected) return "border-danger bg-danger/10 text-ink";
    return "border-border bg-white text-ink-subtle";
  };

  return (
    <div className="flex h-full flex-col justify-between bg-white p-7">
      <div className="overflow-y-auto pt-4">
        <div className="flex items-center gap-2">
          <Kicker>{d.kicker}</Kicker>
          {d.points != null && <span className="font-qsr-mono text-xs font-semibold text-qsr-gold">+{d.points}</span>}
        </div>
        <h2 className="mt-3 font-qsr-display text-xl font-bold leading-snug text-ink">{d.q}</h2>
        <div className="mt-4 space-y-2.5">
          {d.options.map((o, i) => (
            <button
              key={i} type="button" onClick={() => choose(i)} disabled={!!result || busy}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left font-qsr-ui text-[15px] transition active:scale-[0.99] ${optionClass(i)}`}
            >
              <span>{o}</span>
              {result && i === result.answer && <Check className="h-4 w-4 text-success" />}
              {result && i === selected && i !== result.answer && <X className="h-4 w-4 text-danger" />}
            </button>
          ))}
        </div>
        {result?.explain && (
          <p className="mt-4 rounded-2xl bg-surface-sunk px-4 py-3 font-qsr-ui text-sm text-ink-muted">{result.explain}</p>
        )}
      </div>
      <PrimaryBtn onClick={onAdvance} disabled={!result}>Continue ▸</PrimaryBtn>
    </div>
  );
}

// ── reveal (tap to open) ───────────────────────────────────────────────────
export function RevealCard({ card, onAdvance }: CardProps) {
  const d = card.data as RevealData;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-full flex-col justify-between bg-white p-7">
      <div className="pt-4">
        <Kicker>{d.kicker}</Kicker>
        <h2 className="mt-3 font-qsr-display text-2xl font-bold text-ink">{d.title}</h2>
        <button
          type="button" onClick={() => setOpen(true)}
          className={`mt-5 w-full rounded-2xl border p-5 text-left transition active:scale-[0.99] ${
            open ? "border-qsr-azure bg-qsr-azure/5" : "border-dashed border-border bg-surface-sunk"
          }`}
        >
          {open ? (
            <p className="font-qsr-ui text-[15px] leading-relaxed text-ink">{d.reveal}</p>
          ) : (
            <span className="font-qsr-ui text-sm font-semibold text-qsr-azure">Tap to reveal the pro tip</span>
          )}
        </button>
      </div>
      <PrimaryBtn onClick={onAdvance} disabled={!open}>Continue ▸</PrimaryBtn>
    </div>
  );
}

// ── poll (server-aggregated) ───────────────────────────────────────────────
export function PollCard({ card, onAdvance }: CardProps) {
  const d = card.data as PollData;
  const [results, setResults] = useState<number[] | null>(card.progress?.answer_index != null ? (d.results ?? null) : null);
  const [voted, setVoted] = useState(card.progress?.answer_index != null);
  const [busy, setBusy] = useState(false);

  const vote = async (i: number) => {
    if (voted || busy) return;
    setBusy(true);
    try { const r = await votePoll(card.id, i); setResults(r.results); setVoted(true); }
    finally { setBusy(false); }
  };
  const total = (results ?? []).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="flex h-full flex-col justify-between bg-white p-7">
      <div className="pt-4">
        <Kicker>{d.kicker}</Kicker>
        <h2 className="mt-3 font-qsr-display text-xl font-bold leading-snug text-ink">{d.q}</h2>
        <div className="mt-4 space-y-2.5">
          {d.options.map((o, i) => {
            const pctV = voted && results ? Math.round((results[i] / total) * 100) : 0;
            return (
              <button
                key={i} type="button" onClick={() => vote(i)} disabled={voted || busy}
                className="relative w-full overflow-hidden rounded-2xl border border-border px-4 py-3 text-left font-qsr-ui text-[15px] transition active:scale-[0.99]"
              >
                {voted && <span className="absolute inset-y-0 left-0 bg-qsr-azure/10" style={{ width: `${pctV}%` }} />}
                <span className="relative flex items-center justify-between">
                  <span className="text-ink">{o}</span>
                  {voted && <span className="font-qsr-mono text-xs text-ink-muted">{pctV}%</span>}
                </span>
              </button>
            );
          })}
        </div>
        {voted && <p className="mt-3 font-qsr-ui text-xs text-ink-subtle">Crew pulse · {total} {total === 1 ? "vote" : "votes"}</p>}
      </div>
      <PrimaryBtn onClick={onAdvance} disabled={!voted}>Continue ▸</PrimaryBtn>
    </div>
  );
}

// ── done (server-computed completion) ──────────────────────────────────────
export function DoneCard({ card, courseId, onFinish }: { card: LessonCard; courseId: string; onFinish: () => void }) {
  const d = card.data as DoneData;
  const [stats, setStats] = useState<{ points: number; score: string; streak: number } | null>(null);

  useEffect(() => {
    completeLesson(courseId).then((r) => {
      setStats({ points: r.points, score: r.score, streak: r.streak });
      confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    }).catch(() => {});
  }, [courseId]);

  const cells = stats
    ? [{ v: `+${stats.points}`, k: "points" }, { v: stats.score, k: "score" }, { v: `${stats.streak}`, k: "day streak" }]
    : [];

  return (
    <div className="flex h-full flex-col items-center justify-center bg-qsr-azure p-7 text-center text-white">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-qsr-gold/20 ring-1 ring-qsr-gold/40">
        <Check className="h-8 w-8 text-qsr-gold" />
      </div>
      <h1 className="mt-5 font-qsr-display text-3xl font-bold">{d.title}</h1>
      {d.body && <p className="mt-2 font-qsr-ui text-[15px] text-white/85">{d.body}</p>}
      {stats ? (
        <div className="mt-7 flex gap-7">
          {cells.map((c, i) => (
            <div key={i}>
              <div className="font-qsr-display text-2xl font-bold">{c.v}</div>
              <div className="font-qsr-ui text-[11px] uppercase tracking-wide text-white/70">{c.k}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-7 flex items-center gap-2 text-white/60"><Lock className="h-3.5 w-3.5" /> tallying…</div>
      )}
      <div className="mt-9 w-full"><PrimaryBtn tone="white" onClick={onFinish}>Finish ▸</PrimaryBtn></div>
    </div>
  );
}
