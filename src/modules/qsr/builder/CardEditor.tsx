// Per-type card authoring forms (spec §6). Edits a card's `data` object in
// place via setData; the parent owns save/validation round-trips. Mirrors the
// exact field shapes the Player's renderers consume (LessonCards.tsx) so what
// you author is what learners see.
import { Plus, Trash2 } from "lucide-react";
import type { CardType } from "../types";

type Data = Record<string, unknown>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "block w-full rounded-lg border border-border bg-surface px-3 py-2 font-qsr-ui text-sm text-ink focus:border-qsr-azure focus:outline-none focus:ring-1 focus:ring-qsr-azure";

function Text({ value, onChange, placeholder }: { value: unknown; onChange: (v: string) => void; placeholder?: string }) {
  return <input className={inputCls} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}
function Area({ value, onChange, placeholder, rows = 3 }: { value: unknown; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea className={inputCls} rows={rows} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

// Editable list of strings (quiz / poll options).
function OptionList({
  options, answer, onOptions, onAnswer,
}: { options: string[]; answer?: number; onOptions: (v: string[]) => void; onAnswer?: (i: number) => void }) {
  return (
    <div className="space-y-2">
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          {onAnswer && (
            <input
              type="radio"
              checked={answer === i}
              onChange={() => onAnswer(i)}
              className="h-4 w-4 accent-qsr-azure"
              title="Correct answer"
            />
          )}
          <input
            className={inputCls}
            value={opt}
            onChange={(e) => onOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
            placeholder={`Option ${i + 1}`}
          />
          <button
            type="button"
            onClick={() => {
              const next = options.filter((_, j) => j !== i);
              onOptions(next);
              if (onAnswer && answer != null && answer >= next.length) onAnswer(Math.max(0, next.length - 1));
            }}
            className="shrink-0 rounded-md p-1.5 text-ink-subtle hover:bg-surface-sunk hover:text-qsr-crimson"
            title="Remove option"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onOptions([...options, ""])}
        className="inline-flex items-center gap-1 font-qsr-ui text-xs font-semibold text-qsr-azure hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> Add option
      </button>
    </div>
  );
}

export function CardEditor({ type, data, setData }: { type: CardType; data: Data; setData: (d: Data) => void }) {
  const set = (k: string, v: unknown) => setData({ ...data, [k]: v });
  const arr = <T,>(k: string): T[] => (Array.isArray(data[k]) ? (data[k] as T[]) : []);

  // Plain elements, not components — rendering `{kicker}` from a function
  // defined in the render body gives it a new identity every keystroke, which
  // remounts the input and drops focus. Elements inline without remounting.
  const kicker = <Field label="Kicker (small label)"><Text value={data.kicker} onChange={(v) => set("kicker", v)} placeholder="e.g. Carhop Service" /></Field>;
  const title = <Field label="Title"><Text value={data.title} onChange={(v) => set("title", v)} placeholder="Card title" /></Field>;

  switch (type) {
    case "intro": {
      const meta = arr<{ v: string; k: string }>("meta");
      return (
        <div className="space-y-3">
          {kicker}{title}
          <Field label="Body"><Area value={data.body} onChange={(v) => set("body", v)} /></Field>
          <Field label="Meta chips (value · label)">
            <div className="space-y-2">
              {meta.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={inputCls} value={m.v ?? ""} placeholder="8" onChange={(e) => set("meta", meta.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
                  <input className={inputCls} value={m.k ?? ""} placeholder="cards" onChange={(e) => set("meta", meta.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
                  <button type="button" onClick={() => set("meta", meta.filter((_, j) => j !== i))} className="shrink-0 rounded-md p-1.5 text-ink-subtle hover:text-qsr-crimson"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <button type="button" onClick={() => set("meta", [...meta, { v: "", k: "" }])} className="inline-flex items-center gap-1 font-qsr-ui text-xs font-semibold text-qsr-azure hover:underline"><Plus className="h-3.5 w-3.5" /> Add chip</button>
            </div>
          </Field>
        </div>
      );
    }
    case "steps": {
      const steps = arr<{ t: string; d?: string }>("steps");
      return (
        <div className="space-y-3">
          {kicker}{title}
          <Field label="Steps">
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="rounded-lg border border-border p-2">
                  <div className="flex items-center gap-2">
                    <span className="font-qsr-mono text-xs text-ink-subtle">{i + 1}</span>
                    <input className={inputCls} value={s.t ?? ""} placeholder="Step title" onChange={(e) => set("steps", steps.map((x, j) => (j === i ? { ...x, t: e.target.value } : x)))} />
                    <button type="button" onClick={() => set("steps", steps.filter((_, j) => j !== i))} className="shrink-0 rounded-md p-1.5 text-ink-subtle hover:text-qsr-crimson"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <input className={`${inputCls} mt-2`} value={s.d ?? ""} placeholder="Description (optional)" onChange={(e) => set("steps", steps.map((x, j) => (j === i ? { ...x, d: e.target.value } : x)))} />
                </div>
              ))}
              <button type="button" onClick={() => set("steps", [...steps, { t: "", d: "" }])} className="inline-flex items-center gap-1 font-qsr-ui text-xs font-semibold text-qsr-azure hover:underline"><Plus className="h-3.5 w-3.5" /> Add step</button>
            </div>
          </Field>
        </div>
      );
    }
    case "image":
      return (
        <div className="space-y-3">
          {kicker}{title}
          <Field label="Body"><Area value={data.body} onChange={(v) => set("body", v)} /></Field>
          <Field label="Image URL (optional — media milestone)"><Text value={data.imageUrl} onChange={(v) => set("imageUrl", v || null)} placeholder="https://…" /></Field>
        </div>
      );
    case "video":
      return (
        <div className="space-y-3">
          {kicker}{title}
          <Field label="Body"><Area value={data.body} onChange={(v) => set("body", v)} /></Field>
          <Field label="Mux playback ID (optional — media milestone)"><Text value={data.muxPlaybackId} onChange={(v) => set("muxPlaybackId", v || null)} /></Field>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 font-qsr-ui text-sm text-ink">
              <input type="checkbox" checked={!!data.gate} onChange={(e) => set("gate", e.target.checked)} className="h-4 w-4 accent-qsr-azure" />
              Gate (must watch to advance)
            </label>
            <Field label="Threshold">
              <input type="number" min="0" max="1" step="0.05" className={`${inputCls} w-24`} value={(data.threshold as number) ?? 0.9} onChange={(e) => set("threshold", Number(e.target.value))} />
            </Field>
          </div>
        </div>
      );
    case "quiz":
      return (
        <div className="space-y-3">
          {kicker}
          <Field label="Question"><Area value={data.q} onChange={(v) => set("q", v)} rows={2} /></Field>
          <Field label="Options (select the correct one)">
            <OptionList options={arr<string>("options")} answer={data.answer as number} onOptions={(v) => set("options", v)} onAnswer={(i) => set("answer", i)} />
          </Field>
          <Field label="Explanation (shown after answering)"><Area value={data.explain} onChange={(v) => set("explain", v)} rows={2} /></Field>
          <Field label="Points">
            <input type="number" min="0" className={`${inputCls} w-28`} value={(data.points as number) ?? 10} onChange={(e) => set("points", Number(e.target.value))} />
          </Field>
        </div>
      );
    case "reveal":
      return (
        <div className="space-y-3">
          {kicker}{title}
          <Field label="Reveal text (hidden until tapped)"><Area value={data.reveal} onChange={(v) => set("reveal", v)} /></Field>
        </div>
      );
    case "poll":
      return (
        <div className="space-y-3">
          {kicker}
          <Field label="Question"><Area value={data.q} onChange={(v) => set("q", v)} rows={2} /></Field>
          <Field label="Options"><OptionList options={arr<string>("options")} onOptions={(v) => set("options", v)} /></Field>
          <p className="font-qsr-ui text-[11px] text-ink-subtle">Results are tallied server-side and start at zero.</p>
        </div>
      );
    case "done":
      return (
        <div className="space-y-3">
          {title}
          <Field label="Body"><Area value={data.body} onChange={(v) => set("body", v)} /></Field>
          <p className="font-qsr-ui text-[11px] text-ink-subtle">Points/score/streak are filled in by the server on completion.</p>
        </div>
      );
    default:
      return null;
  }
}
