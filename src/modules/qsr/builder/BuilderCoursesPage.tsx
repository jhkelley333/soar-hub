// Course Builder home — all courses (drafts + published) with create / edit /
// publish / delete. Admin-only (route-gated). Writes go through qsr-author,
// which re-checks author capability.
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Pencil, PencilRuler, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useToast } from "@/shared/ui/Toaster";
import { listBuilderCourses, saveCourse, setCoursePublish, deleteBuilderCourse, generateCourse } from "../api";

export function BuilderCoursesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [aiOpen, setAiOpen] = useState(false);
  const coursesQ = useQuery({ queryKey: ["qsr", "builder", "courses"], queryFn: listBuilderCourses });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["qsr", "builder", "courses"] });

  const create = useMutation({
    mutationFn: () => saveCourse({ title: "Untitled course" }),
    onSuccess: (r) => { toast.push("Course created.", "success"); nav(`/qsr/builder/${r.course.id}`); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });
  const publish = useMutation({
    mutationFn: (vars: { id: string; publish: boolean }) => setCoursePublish(vars.id, vars.publish),
    onSuccess: () => { invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteBuilderCourse(id),
    onSuccess: () => { toast.push("Course deleted.", "success"); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  const courses = coursesQ.data?.courses ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/qsr" className="inline-flex items-center gap-1.5 font-qsr-ui text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> SOAR QSR
      </Link>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PencilRuler className="h-5 w-5 text-qsr-azure" />
          <h1 className="font-qsr-display text-2xl font-bold text-ink">Course Builder</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setAiOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-qsr-azure px-3 py-2 font-qsr-ui text-sm font-semibold text-qsr-azure hover:bg-qsr-azure/5">
            <Sparkles className="h-4 w-4" /> Generate with AI
          </button>
          <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-qsr-azure px-3 py-2 font-qsr-ui text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New course
          </button>
        </div>
      </div>

      {aiOpen && <AiGenerateModal onClose={() => setAiOpen(false)} onDone={(id) => { invalidate(); nav(`/qsr/builder/${id}`); }} />}

      <div className="mt-5 space-y-3">
        {coursesQ.isLoading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-surface-sunk" />
        ) : coursesQ.isError ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-5 font-qsr-ui text-sm text-ink-muted">
            Couldn't load courses. If the QSR tables aren't on this database yet, run migrations <span className="font-qsr-mono">0164</span>–<span className="font-qsr-mono">0165</span> on Soar Hub v2.
          </div>
        ) : courses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-center font-qsr-ui text-sm text-ink-muted">
            No courses yet. Create your first one.
          </div>
        ) : (
          courses.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {c.category && <span className="text-[11px] font-semibold uppercase tracking-wider text-qsr-crimson">{c.category}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${c.status === "published" ? "bg-qsr-azure/10 text-qsr-azure" : "bg-surface-sunk text-ink-subtle"}`}>{c.status}</span>
                </div>
                <h3 className="mt-0.5 truncate font-qsr-display text-base font-semibold text-ink">{c.title}</h3>
                <div className="mt-1 flex flex-wrap gap-x-4 font-qsr-mono text-[11px] text-ink-muted">
                  <span>{c.lesson_count} lessons</span>
                  <span>{c.card_count} cards</span>
                  <span>+{c.total_points ?? c.points} pts</span>
                </div>
              </div>
              <button type="button" onClick={() => publish.mutate({ id: c.id, publish: c.status !== "published" })} disabled={publish.isPending} className="rounded-lg border border-border px-3 py-1.5 font-qsr-ui text-xs font-semibold text-ink hover:border-qsr-azure">
                {c.status === "published" ? "Unpublish" : "Publish"}
              </button>
              <Link to={`/qsr/builder/${c.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 font-qsr-ui text-xs font-semibold text-white hover:brightness-110">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
              <button type="button" onClick={() => { if (confirm(`Delete "${c.title}" and all its lessons/cards?`)) remove.mutate(c.id); }} className="rounded-lg p-2 text-ink-subtle hover:text-qsr-crimson" title="Delete course"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const inputCls = "block w-full rounded-lg border border-border bg-surface px-3 py-2 font-qsr-ui text-sm text-ink focus:border-qsr-azure focus:outline-none focus:ring-1 focus:ring-qsr-azure";

function AiGenerateModal({ onClose, onDone }: { onClose: () => void; onDone: (courseId: string) => void }) {
  const toast = useToast();
  const [topic, setTopic] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [lessons, setLessons] = useState(1);

  const gen = useMutation({
    mutationFn: () => generateCourse({ topic: topic.trim(), sourceText: sourceText.trim() || undefined, lessons }),
    onSuccess: (r) => { toast.push(`Drafted “${r.title}” — review and publish when ready.`, "success"); onDone(r.course_id); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Generation failed.", "error"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-qsr-azure" />
            <h2 className="font-qsr-display text-lg font-bold text-ink">Generate a course with AI</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-subtle hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-3 font-qsr-ui text-xs text-ink-muted">
          Describe a topic, or paste an SOP / policy to adapt. The AI drafts a swipeable card deck — intro, steps, a quiz, a pro tip, and a finish card — as a <span className="font-semibold">draft</span> you review and edit before publishing.
        </p>
        <label className="mb-3 block">
          <span className="mb-1 block font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Topic</span>
          <input className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. How to make the perfect SONIC Blast" autoFocus />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Paste source material (optional)</span>
          <textarea className={inputCls} rows={5} value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="Paste an SOP, policy, or notes to base the lesson on…" />
        </label>
        <label className="mb-4 flex items-center gap-2 font-qsr-ui text-sm text-ink">
          Lessons
          <select className={`${inputCls} w-20`} value={lessons} onChange={(e) => setLessons(Number(e.target.value))}>
            <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 font-qsr-ui text-sm font-semibold text-ink">Cancel</button>
          <button type="button" onClick={() => gen.mutate()} disabled={gen.isPending || (!topic.trim() && !sourceText.trim())} className="inline-flex items-center gap-1.5 rounded-lg bg-qsr-azure px-3 py-2 font-qsr-ui text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40">
            {gen.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Drafting…</> : <><Sparkles className="h-4 w-4" /> Generate draft</>}
          </button>
        </div>
      </div>
    </div>
  );
}
