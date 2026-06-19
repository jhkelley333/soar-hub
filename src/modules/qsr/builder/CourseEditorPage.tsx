// Course Builder — edit one course: metadata, lessons, and cards (per-type
// editors), with reorder, publish guard, and a live Player preview. Admin-only
// (route-gated); the qsr-author backend re-checks author capability + validates
// each card before it persists.
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, BellRing, ChevronDown, ChevronUp, Eye, GripVertical, Languages, Loader2, Plus, Save, Trash2,
} from "lucide-react";
import { useToast } from "@/shared/ui/Toaster";
import { ROLE_LABELS } from "@/types/database";
import type { CardType } from "../types";
import {
  getCourseTree, saveCourse, setCoursePublish, saveLesson, deleteLesson,
  saveCard, deleteCard, reorderBuilder, translateCourse,
  type BuilderCard, type BuilderLesson,
} from "../api";
import { CardEditor } from "./CardEditor";

const CARD_LABELS: Record<CardType, string> = {
  intro: "Intro", steps: "Steps", image: "Image", video: "Video",
  quiz: "Quiz", reveal: "Reveal", poll: "Poll", done: "Done",
};
const CARD_ORDER: CardType[] = ["intro", "steps", "image", "video", "quiz", "reveal", "poll", "done"];

function defaultData(type: CardType): Record<string, unknown> {
  switch (type) {
    case "steps": return { title: "", steps: [{ t: "", d: "" }] };
    case "video": return { title: "", gate: true, threshold: 0.9 };
    case "quiz": return { q: "", options: ["", ""], points: 10 };
    case "reveal": return { title: "", reveal: "" };
    case "poll": return { q: "", options: ["", ""] };
    default: return { title: "" };
  }
}

function cardPreview(c: BuilderCard): string {
  const d = c.data as Record<string, unknown>;
  return (d.title as string) || (d.q as string) || (d.reveal as string) || "Untitled";
}

const inputCls =
  "block w-full rounded-lg border border-border bg-surface px-3 py-2 font-qsr-ui text-sm text-ink focus:border-qsr-azure focus:outline-none focus:ring-1 focus:ring-qsr-azure";

export function CourseEditorPage() {
  const { courseId = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const treeQ = useQuery({ queryKey: ["qsr", "builder", courseId], queryFn: () => getCourseTree(courseId), enabled: !!courseId });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["qsr", "builder", courseId] });

  if (treeQ.isLoading) return <div className="mx-auto max-w-3xl"><div className="h-40 animate-pulse rounded-2xl bg-surface-sunk" /></div>;
  if (treeQ.isError || !treeQ.data) return <div className="mx-auto max-w-3xl text-sm text-ink-muted">Couldn't load this course.</div>;

  const { course, lessons } = treeQ.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/qsr/builder" className="inline-flex items-center gap-1.5 font-qsr-ui text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> All courses
        </Link>
        <div className="flex items-center gap-2">
          <TranslateButton courseId={course.id} onDone={invalidate} toast={toast} />
          <Link to={`/qsr/course/${course.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-qsr-ui text-sm font-semibold text-ink hover:border-qsr-azure">
            <Eye className="h-4 w-4" /> Preview
          </Link>
          <PublishButton courseId={course.id} status={course.status} onDone={invalidate} />
        </div>
      </div>

      <CourseMetaForm course={course} onSaved={invalidate} />

      <div className="space-y-4">
        {lessons.map((lesson) => (
          <LessonBlock key={lesson.id} lesson={lesson} onChanged={invalidate} toast={toast} />
        ))}
        <AddLesson courseId={course.id} hasLessons={lessons.length > 0} onAdded={invalidate} toast={toast} />
      </div>
    </div>
  );
}

function TranslateButton({ courseId, onDone, toast }: { courseId: string; onDone: () => void; toast: ReturnType<typeof useToast> }) {
  const m = useMutation({
    mutationFn: () => translateCourse(courseId),
    onSuccess: (r) => { toast.push(`Translated ${r.translated} card${r.translated === 1 ? "" : "s"} to Spanish — review in each card's “Spanish” panel.`, "success"); onDone(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Translation failed.", "error"),
  });
  return (
    <button
      type="button"
      onClick={() => { if (confirm("Auto-translate every card to Spanish? Existing Spanish text will be overwritten (your Spanish video URLs are kept).")) m.mutate(); }}
      disabled={m.isPending}
      title="Fill each card's Spanish translation with AI"
      className="inline-flex items-center gap-1.5 rounded-lg border border-qsr-azure px-3 py-1.5 font-qsr-ui text-sm font-semibold text-qsr-azure hover:bg-qsr-azure/5 disabled:opacity-40"
    >
      {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />} {m.isPending ? "Translating…" : "Translate to Spanish"}
    </button>
  );
}

function PublishButton({ courseId, status, onDone }: { courseId: string; status: string; onDone: () => void }) {
  const toast = useToast();
  const publish = status !== "published";
  const m = useMutation({
    mutationFn: () => setCoursePublish(courseId, publish),
    onSuccess: () => { toast.push(publish ? "Course published." : "Course unpublished.", "success"); onDone(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });
  return (
    <button
      type="button"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-qsr-ui text-sm font-semibold text-white ${publish ? "bg-qsr-azure hover:brightness-110" : "bg-ink-subtle hover:brightness-110"}`}
    >
      {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
      {publish ? "Publish" : "Unpublish"}
    </button>
  );
}

// "Shift Manager and above" — the role tiers don't separate shift managers from
// crew numerically, so this is an explicit, editable default.
const REQUIRE_ROLE_OPTIONS = ["shift_manager", "first_assistant_manager", "associate_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"];

function CourseMetaForm({ course, onSaved }: { course: { id: string; title: string; category: string | null; description: string | null; est_minutes: number | null; points: number; status: string; requirement_cadence?: string | null; requirement_roles?: string[] | null }; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(course.title);
  const [category, setCategory] = useState(course.category ?? "");
  const [description, setDescription] = useState(course.description ?? "");
  const [estMinutes, setEstMinutes] = useState(course.est_minutes?.toString() ?? "");
  const [points, setPoints] = useState(course.points?.toString() ?? "0");
  const [cadence, setCadence] = useState(course.requirement_cadence ?? "");
  const [roles, setRoles] = useState<string[]>(course.requirement_roles?.length ? course.requirement_roles : REQUIRE_ROLE_OPTIONS);
  const toggleRole = (r: string) => setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));

  const m = useMutation({
    mutationFn: () => saveCourse({
      id: course.id, title: title.trim(), category: category.trim() || null,
      description: description.trim() || null,
      est_minutes: estMinutes === "" ? null : Number(estMinutes), points: Number(points) || 0,
      requirement_cadence: cadence || null,
      requirement_roles: cadence ? roles : [],
    }),
    onSuccess: () => { toast.push("Course saved.", "success"); onSaved(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-qsr-display text-lg font-semibold text-ink">Course details</h2>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${course.status === "published" ? "bg-qsr-azure/10 text-qsr-azure" : "bg-surface-sunk text-ink-subtle"}`}>{course.status}</span>
      </div>
      <div className="space-y-3">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Course title" />
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (e.g. Carhop Service)" />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Est. minutes</span>
              <input className={inputCls} type="number" min="0" value={estMinutes} onChange={(e) => setEstMinutes(e.target.value)} placeholder="e.g. 5" />
            </label>
            <label className="block">
              <span className="mb-1 block font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Completion points</span>
              <input className={inputCls} type="number" min="0" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="e.g. 50" />
            </label>
          </div>
        </div>
        <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />

        {/* Required training — pops up on login until completed in the window */}
        <div className="rounded-xl border border-border bg-surface-sunk/40 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-qsr-ui text-sm font-semibold text-ink"><BellRing className="h-4 w-4 text-qsr-azure" /> Required training</span>
            <select className={`${inputCls} w-auto`} value={cadence} onChange={(e) => setCadence(e.target.value)}>
              <option value="">Not required</option>
              <option value="quarterly">Every quarter</option>
              <option value="annual">Once a year</option>
            </select>
          </div>
          {cadence && (
            <div className="mt-3">
              <span className="mb-1.5 block font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Required for these roles</span>
              <div className="flex flex-wrap gap-1.5">
                {REQUIRE_ROLE_OPTIONS.map((r) => (
                  <button key={r} type="button" onClick={() => toggleRole(r)} className={`rounded-full px-2.5 py-1 font-qsr-ui text-xs font-semibold transition ${roles.includes(r) ? "bg-qsr-azure text-white" : "bg-surface text-ink-muted ring-1 ring-border"}`}>
                    {ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}
                  </button>
                ))}
              </div>
              <p className="mt-2 font-qsr-ui text-[11px] text-ink-subtle">Anyone in these roles who hasn’t completed it this {cadence === "annual" ? "year" : "quarter"} gets a reminder pop-up at login. Default is Shift Manager and above.</p>
            </div>
          )}
        </div>

        <button type="button" onClick={() => m.mutate()} disabled={m.isPending || !title.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 font-qsr-ui text-sm font-semibold text-white disabled:opacity-40">
          {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save details
        </button>
      </div>
    </div>
  );
}

function LessonBlock({ lesson, onChanged, toast }: { lesson: BuilderLesson; onChanged: () => void; toast: ReturnType<typeof useToast> }) {
  const [title, setTitle] = useState(lesson.title);
  const [mod, setMod] = useState(lesson.module ?? "");
  const cards = lesson.cards;

  const saveMeta = useMutation({
    mutationFn: () => saveLesson({ id: lesson.id, title: title.trim(), module: mod.trim() || null }),
    onSuccess: () => { toast.push("Lesson saved.", "success"); onChanged(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });
  const removeLesson = useMutation({
    mutationFn: () => deleteLesson(lesson.id),
    onSuccess: () => { toast.push("Lesson deleted.", "success"); onChanged(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });
  const move = useMutation({
    mutationFn: (vars: { items: { id: string; ord: number }[] }) => reorderBuilder("cards", vars.items),
    onSuccess: onChanged,
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Reorder failed.", "error"),
  });
  function swap(i: number, j: number) {
    if (j < 0 || j >= cards.length) return;
    move.mutate({ items: [{ id: cards[i].id, ord: cards[j].ord }, { id: cards[j].id, ord: cards[i].ord }] });
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1">
          <span className="mb-1 block font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Lesson title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="w-40">
          <span className="mb-1 block font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Module</span>
          <input className={inputCls} value={mod} onChange={(e) => setMod(e.target.value)} />
        </label>
        <button type="button" onClick={() => saveMeta.mutate()} disabled={saveMeta.isPending} className="rounded-lg border border-border px-3 py-2 font-qsr-ui text-sm font-semibold text-ink hover:border-qsr-azure">Save</button>
        <button type="button" onClick={() => { if (confirm("Delete this lesson and its cards?")) removeLesson.mutate(); }} className="rounded-lg p-2 text-ink-subtle hover:text-qsr-crimson" title="Delete lesson"><Trash2 className="h-4 w-4" /></button>
      </div>

      <div className="mt-4 space-y-2">
        {cards.map((card, i) => (
          <CardRow key={card.id} card={card} index={i} count={cards.length} onChanged={onChanged} toast={toast} onMoveUp={() => swap(i, i - 1)} onMoveDown={() => swap(i, i + 1)} />
        ))}
        {cards.length === 0 && <p className="font-qsr-ui text-sm text-ink-muted">No cards yet — add the first below.</p>}
      </div>

      <AddCard lessonId={lesson.id} onAdded={onChanged} toast={toast} />
    </div>
  );
}

function CardRow({ card, index, count, onChanged, toast, onMoveUp, onMoveDown }: {
  card: BuilderCard; index: number; count: number; onChanged: () => void;
  toast: ReturnType<typeof useToast>; onMoveUp: () => void; onMoveDown: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Record<string, unknown>>(card.data as Record<string, unknown>);

  const save = useMutation({
    mutationFn: () => saveCard({ id: card.id, type: card.type, data }),
    onSuccess: () => { toast.push("Card saved.", "success"); setOpen(false); onChanged(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });
  const remove = useMutation({
    mutationFn: () => deleteCard(card.id),
    onSuccess: () => { toast.push("Card deleted.", "success"); onChanged(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  // The intro is the lesson's hero card — its title renders as the headline,
  // so it can't be saved blank.
  const titleMissing = card.type === "intro" && !((data.title as string) || "").trim();

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex flex-col">
          <button type="button" onClick={onMoveUp} disabled={index === 0} className="text-ink-subtle disabled:opacity-25 hover:text-ink"><ChevronUp className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onMoveDown} disabled={index === count - 1} className="text-ink-subtle disabled:opacity-25 hover:text-ink"><ChevronDown className="h-3.5 w-3.5" /></button>
        </div>
        <GripVertical className="h-4 w-4 text-ink-subtle" />
        <span className="rounded-md bg-surface-sunk px-2 py-0.5 font-qsr-mono text-[10px] font-semibold uppercase text-ink-muted">{card.type}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex-1 truncate text-left font-qsr-ui text-sm text-ink hover:text-qsr-azure">{cardPreview(card)}</button>
        <button type="button" onClick={() => { if (confirm("Delete this card?")) remove.mutate(); }} className="rounded-md p-1.5 text-ink-subtle hover:text-qsr-crimson"><Trash2 className="h-4 w-4" /></button>
      </div>
      {open && (
        <div className="border-t border-border bg-surface-sunk/40 p-4">
          <CardEditor type={card.type} data={data} setData={setData} cardId={card.id} />
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending || titleMissing} className="inline-flex items-center gap-1.5 rounded-lg bg-qsr-azure px-3 py-2 font-qsr-ui text-sm font-semibold text-white disabled:opacity-40">
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save card
            </button>
            <button type="button" onClick={() => { setData(card.data as Record<string, unknown>); setOpen(false); }} className="rounded-lg border border-border px-3 py-2 font-qsr-ui text-sm font-semibold text-ink">Cancel</button>
            {titleMissing && <span className="font-qsr-ui text-xs text-qsr-crimson">An intro card needs a title.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function AddCard({ lessonId, onAdded, toast }: { lessonId: string; onAdded: () => void; toast: ReturnType<typeof useToast> }) {
  const [type, setType] = useState<CardType>("intro");
  const add = useMutation({
    mutationFn: () => saveCard({ lesson_id: lessonId, type, data: defaultData(type) }),
    onSuccess: () => { toast.push(`${CARD_LABELS[type]} card added.`, "success"); onAdded(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });
  return (
    <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
      <select className={`${inputCls} w-40`} value={type} onChange={(e) => setType(e.target.value as CardType)}>
        {CARD_ORDER.map((t) => <option key={t} value={t}>{CARD_LABELS[t]}</option>)}
      </select>
      <button type="button" onClick={() => add.mutate()} disabled={add.isPending} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-qsr-azure/50 px-3 py-2 font-qsr-ui text-sm font-semibold text-qsr-azure hover:bg-qsr-azure/5">
        {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add card
      </button>
    </div>
  );
}

function AddLesson({ courseId, hasLessons, onAdded, toast }: { courseId: string; hasLessons: boolean; onAdded: () => void; toast: ReturnType<typeof useToast> }) {
  const add = useMutation({
    mutationFn: () => saveLesson({ course_id: courseId, title: "New lesson" }),
    onSuccess: () => { toast.push("Lesson added.", "success"); onAdded(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });
  return (
    <button type="button" onClick={() => add.mutate()} disabled={add.isPending} className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border py-3 font-qsr-ui text-sm font-semibold text-ink-muted hover:border-qsr-azure hover:text-qsr-azure">
      {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {hasLessons ? "Add another lesson" : "Add a lesson"}
    </button>
  );
}
