// Per-type card authoring forms (spec §6). Edits a card's `data` object in
// place via setData; the parent owns save/validation round-trips. Mirrors the
// exact field shapes the Player's renderers consume (LessonCards.tsx) so what
// you author is what learners see.
import { useRef, useState } from "react";
import { Languages, Loader2, Plus, Trash2, Upload } from "lucide-react";
import type { CardType } from "../types";
import { uploadQsrMedia } from "../api";

type Data = Record<string, unknown>;

// Drag-drop / picker that uploads an image or video to Supabase Storage and
// hands back its public URL. Needs a saved card (cardId) to key the path.
function MediaUpload({ cardId, accept, label, onUploaded }: {
  cardId?: string; accept: string; label: string; onUploaded: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = async (file?: File | null) => {
    if (!file) return;
    if (!cardId) { setErr("Save the card once before uploading."); return; }
    setBusy(true); setErr(null);
    try { onUploaded(await uploadQsrMedia(file, cardId)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); handle(e.dataTransfer.files?.[0]); }}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2"
    >
      <button
        type="button" onClick={() => inputRef.current?.click()} disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-ink px-2.5 py-1.5 font-qsr-ui text-xs font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {busy ? "Uploading…" : label}
      </button>
      <span className="font-qsr-ui text-[11px] text-ink-subtle">or drag a file here</span>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      {err && <span className="w-full font-qsr-ui text-[11px] text-qsr-crimson">{err}</span>}
    </div>
  );
}

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

// Editable list of strings (quiz / poll options). When `multi`, the correct
// marker is a checkbox set (answers[] via onAnswers); otherwise a single radio.
function OptionList({
  options, answer, answers, multi, onOptions, onAnswer, onAnswers,
}: {
  options: string[]; answer?: number; answers?: number[]; multi?: boolean;
  onOptions: (v: string[]) => void; onAnswer?: (i: number) => void; onAnswers?: (v: number[]) => void;
}) {
  const sel = answers ?? [];
  const toggle = (i: number) => onAnswers?.(sel.includes(i) ? sel.filter((a) => a !== i) : [...sel, i].sort((a, b) => a - b));
  const removeAt = (i: number) => {
    onOptions(options.filter((_, j) => j !== i));
    if (multi) {
      onAnswers?.(sel.filter((a) => a !== i).map((a) => (a > i ? a - 1 : a)));
    } else if (onAnswer && answer != null && answer >= options.length - 1) {
      onAnswer(Math.max(0, options.length - 2));
    }
  };
  return (
    <div className="space-y-2">
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          {multi ? (
            <input
              type="checkbox"
              checked={sel.includes(i)}
              onChange={() => toggle(i)}
              className="h-4 w-4 accent-qsr-azure"
              title="Correct answer"
            />
          ) : onAnswer ? (
            <input
              type="radio"
              checked={answer === i}
              onChange={() => onAnswer(i)}
              className="h-4 w-4 accent-qsr-azure"
              title="Correct answer"
            />
          ) : null}
          <input
            className={inputCls}
            value={opt}
            onChange={(e) => onOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
            placeholder={`Option ${i + 1}`}
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
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

export function CardEditor({ type, data, setData, cardId }: { type: CardType; data: Data; setData: (d: Data) => void; cardId?: string }) {
  const set = (k: string, v: unknown) => setData({ ...data, [k]: v });
  const arr = <T,>(k: string): T[] => (Array.isArray(data[k]) ? (data[k] as T[]) : []);

  // Plain elements, not components — rendering `{kicker}` from a function
  // defined in the render body gives it a new identity every keystroke, which
  // remounts the input and drops focus. Elements inline without remounting.
  const kicker = <Field label="Kicker (small label)"><Text value={data.kicker} onChange={(v) => set("kicker", v)} placeholder="e.g. Carhop Service" /></Field>;
  const title = <Field label="Title"><Text value={data.title} onChange={(v) => set("title", v)} placeholder="Card title" /></Field>;

  const en = (() => {
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
          <Field label="Image">
            <div className="space-y-2">
              <Text value={data.imageUrl} onChange={(v) => set("imageUrl", v || null)} placeholder="https://… or upload below" />
              <MediaUpload cardId={cardId} accept="image/*" label="Upload image" onUploaded={(url) => set("imageUrl", url)} />
              {typeof data.imageUrl === "string" && data.imageUrl && (
                <img src={data.imageUrl} alt="" className="max-h-32 rounded-lg border border-border object-cover" />
              )}
            </div>
          </Field>
        </div>
      );
    case "video":
      return (
        <div className="space-y-3">
          {kicker}{title}
          <Field label="Body"><Area value={data.body} onChange={(v) => set("body", v)} /></Field>
          <Field label="Video — upload a file or paste a URL / embed code">
            <div className="space-y-2">
              <MediaUpload cardId={cardId} accept="video/*,.mp4,.mov,.webm" label="Upload video (.mp4)" onUploaded={(url) => set("videoUrl", url)} />
              <Area value={data.videoUrl} onChange={(v) => set("videoUrl", v || null)} rows={2} placeholder={'…or paste https://youtu.be/…  ·  a direct .mp4  ·  a full <iframe …> embed (HeyGen, Loom, Wistia)'} />
            </div>
          </Field>
          <p className="-mt-1 font-qsr-ui text-[11px] text-ink-subtle">
            Upload an .mp4 for exact watch-tracking (best for HeyGen — download the MP4, drop it here), or paste a YouTube/Vimeo link or a whole <code>&lt;iframe&gt;</code> embed. MP4 gates on real watch %; embeds gate on elapsed time.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 font-qsr-ui text-sm text-ink">
              <input type="checkbox" checked={!!data.gate} onChange={(e) => set("gate", e.target.checked)} className="h-4 w-4 accent-qsr-azure" />
              Gate (must watch to advance)
            </label>
            <Field label="Threshold">
              <input type="number" min="0" max="1" step="0.05" className={`${inputCls} w-24`} value={(data.threshold as number) ?? 0.9} onChange={(e) => set("threshold", Number(e.target.value))} />
            </Field>
            <Field label="Approx length (sec, for embeds)">
              <input type="number" min="0" step="5" className={`${inputCls} w-28`} value={(data.lengthSec as number) ?? ""} placeholder="e.g. 120" onChange={(e) => set("lengthSec", e.target.value ? Number(e.target.value) : undefined)} />
            </Field>
          </div>
        </div>
      );
    case "quiz":
      return (
        <div className="space-y-3">
          {kicker}
          <Field label="Question"><Area value={data.q} onChange={(v) => set("q", v)} rows={2} /></Field>
          <label className="flex items-center gap-2 font-qsr-ui text-sm text-ink">
            <input
              type="checkbox" checked={!!data.multi} className="h-4 w-4 accent-qsr-azure"
              onChange={(e) => set("multi", e.target.checked)}
            />
            Multiple correct answers
          </label>
          <Field label={data.multi ? "Options (check all correct answers)" : "Options (select the correct one)"}>
            <OptionList
              options={arr<string>("options")} multi={!!data.multi}
              answer={data.answer as number} answers={arr<number>("answers")}
              onOptions={(v) => set("options", v)}
              onAnswer={(i) => set("answer", i)} onAnswers={(v) => set("answers", v)}
            />
          </Field>
          {!!data.multi && arr<number>("answers").length === 0 && (
            <p className="-mt-1 font-qsr-ui text-[11px] text-qsr-crimson">Check at least one correct answer.</p>
          )}
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
  })();

  return (
    <div className="space-y-4">
      {en}
      <SpanishSection type={type} data={data} setData={setData} />
    </div>
  );
}

// Spanish translation overlay for one card — text-only inputs bound to
// data.i18n.es (+ a Spanish video URL), shown when the learner picks Español.
// Structure (option/step counts, answer keys) stays owned by the English form;
// this only translates the visible text, so nothing can desync.
function SpanishSection({ type, data, setData }: { type: CardType; data: Data; setData: (d: Data) => void }) {
  const [open, setOpen] = useState(false);
  const i18n = (data.i18n && typeof data.i18n === "object" ? data.i18n : {}) as Record<string, Record<string, unknown>>;
  const es = (i18n.es ?? {}) as Record<string, unknown>;
  const setEs = (k: string, v: unknown) => setData({ ...data, i18n: { ...i18n, es: { ...es, [k]: v } } });
  const enArr = <T,>(k: string): T[] => (Array.isArray(data[k]) ? (data[k] as T[]) : []);
  const esArr = <T,>(k: string): T[] => (Array.isArray(es[k]) ? (es[k] as T[]) : []);

  const fields: React.ReactNode[] = [];
  const scalar = (k: string, label: string, area = false) => {
    fields.push(
      <Field key={k} label={label}>
        {area
          ? <Area value={es[k]} onChange={(v) => setEs(k, v)} placeholder={String(data[k] ?? "")} />
          : <Text value={es[k]} onChange={(v) => setEs(k, v)} placeholder={String(data[k] ?? "")} />}
      </Field>,
    );
  };
  if (type === "intro" || type === "image") { scalar("kicker", "Kicker"); scalar("title", "Title"); scalar("body", "Body", true); }
  if (type === "reveal") { scalar("kicker", "Kicker"); scalar("title", "Title"); scalar("reveal", "Reveal text", true); }
  if (type === "done") { scalar("title", "Title"); scalar("body", "Body", true); }
  if (type === "steps") {
    scalar("kicker", "Kicker"); scalar("title", "Title");
    const enSteps = enArr<{ t: string; d?: string }>("steps");
    const esSteps = esArr<{ t?: string; d?: string }>("steps");
    const setStep = (i: number, key: "t" | "d", v: string) => {
      const next = enSteps.map((_, j) => ({ ...(esSteps[j] ?? {}) }));
      next[i] = { ...next[i], [key]: v };
      setEs("steps", next);
    };
    fields.push(
      <Field key="steps" label="Steps">
        <div className="space-y-2">
          {enSteps.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-2">
              <input className={inputCls} value={(esSteps[i]?.t as string) ?? ""} placeholder={s.t} onChange={(e) => setStep(i, "t", e.target.value)} />
              <input className={`${inputCls} mt-2`} value={(esSteps[i]?.d as string) ?? ""} placeholder={s.d || "(optional)"} onChange={(e) => setStep(i, "d", e.target.value)} />
            </div>
          ))}
        </div>
      </Field>,
    );
  }
  if (type === "quiz" || type === "poll") {
    scalar("q", "Question", true);
    const enOpts = enArr<string>("options");
    const esOpts = esArr<string>("options");
    const setOpt = (i: number, v: string) => {
      const next = enOpts.map((_, j) => esOpts[j] ?? "");
      next[i] = v;
      setEs("options", next);
    };
    fields.push(
      <Field key="options" label="Options (same order as English)">
        <div className="space-y-2">
          {enOpts.map((o, i) => (
            <input key={i} className={inputCls} value={esOpts[i] ?? ""} placeholder={o} onChange={(e) => setOpt(i, e.target.value)} />
          ))}
        </div>
      </Field>,
    );
    if (type === "quiz") scalar("explain", "Explanation", true);
  }
  if (type === "video") {
    scalar("kicker", "Kicker"); scalar("title", "Title"); scalar("body", "Body", true);
    fields.push(
      <Field key="videoUrl" label="Spanish video — URL / .mp4 / embed (plays when learner picks ES)">
        <Area value={es.videoUrl} onChange={(v) => setEs("videoUrl", v || "")} rows={2} placeholder="Leave blank to reuse the English video" />
      </Field>,
    );
  }

  return (
    <div className="rounded-lg border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-3 py-2 font-qsr-ui text-xs font-semibold uppercase tracking-wide text-ink-muted">
        <span className="inline-flex items-center gap-1.5"><Languages className="h-3.5 w-3.5" /> Spanish (Español)</span>
        <span className="text-qsr-azure">{open ? "Hide" : "Edit"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <p className="font-qsr-ui text-[11px] text-ink-subtle">Shown when the learner switches to Español. Blank fields fall back to English. Use “Translate to Spanish” on the course to auto-fill.</p>
          {fields}
        </div>
      )}
    </div>
  );
}
