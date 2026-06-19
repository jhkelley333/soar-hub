// SOAR QSR — client data access. Reads go straight through supabase-js under
// RLS (published courses are readable by any signed-in user; authors see all).
// Server-authoritative actions (scoring, progress) get Netlify functions in
// later milestones.
import { supabase } from "@/lib/supabase";
import type { CardType, LessonPayload } from "./types";

export interface QsrCourseSummary {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  status: "draft" | "published";
  est_minutes: number | null;
  points: number;
  total_points?: number; // completion points + every quiz card's points (view 0170)
  lesson_count: number;
  card_count: number;
}

export async function listQsrCourses(): Promise<QsrCourseSummary[]> {
  const { data, error } = await supabase
    .from("qsr_course_summary")
    .select("id, title, category, description, status, est_minutes, points, total_points, lesson_count, card_count")
    .order("title");
  if (error) throw new Error(error.message);
  return (data ?? []) as QsrCourseSummary[];
}

// ── Learner runtime (server-authoritative; see netlify/functions/qsr-learn) ──
const LEARN_FN = "/.netlify/functions/qsr-learn";

async function learnFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export function fetchLesson(courseId: string): Promise<LessonPayload> {
  return learnFetch<LessonPayload>(`${LEARN_FN}?action=lesson&course_id=${encodeURIComponent(courseId)}`);
}

export function recordCardProgress(
  cardId: string, state: "seen" | "answered" | "passed", watchedPct?: number,
): Promise<{ ok: true; state: string; passable?: boolean }> {
  return learnFetch(`${LEARN_FN}?action=progress`, {
    method: "POST",
    body: JSON.stringify({ card_id: cardId, state, watched_pct: watchedPct }),
  });
}

export function answerQuiz(
  cardId: string, selection: number | number[],
): Promise<{ ok: true; correct: boolean; pointsAwarded: number; answer: number | null; answers?: number[]; multi?: boolean; explain: string | null }> {
  const body = Array.isArray(selection)
    ? { card_id: cardId, answer_indices: selection }
    : { card_id: cardId, answer_index: selection };
  return learnFetch(`${LEARN_FN}?action=quiz`, { method: "POST", body: JSON.stringify(body) });
}

export function votePoll(cardId: string, optionIndex: number): Promise<{ ok: true; results: number[] }> {
  return learnFetch(`${LEARN_FN}?action=poll`, {
    method: "POST",
    body: JSON.stringify({ card_id: cardId, option_index: optionIndex }),
  });
}

export function completeLesson(
  courseId: string,
): Promise<{ ok: true; points: number; score: string; streak: number; longest: number; newBadges: string[] }> {
  return learnFetch(`${LEARN_FN}?action=complete`, {
    method: "POST",
    body: JSON.stringify({ course_id: courseId }),
  });
}

// ── Gamification (Milestone 3) ───────────────────────────────────────────────
export interface QsrBadge { key?: string; name?: string; icon?: string | null; earned_at: string }
export interface QsrStats {
  points: number;
  streak: { current: number; longest: number; atRisk: boolean };
  badges: QsrBadge[];
}
export function fetchQsrStats(): Promise<QsrStats> {
  return learnFetch<QsrStats>(`${LEARN_FN}?action=stats`);
}

export interface QsrLeaderboardEntry { user_id: string; name: string; points: number; isMe: boolean }
export interface QsrLeaderboard { storeId: string | null; entries: QsrLeaderboardEntry[] }
export function fetchQsrLeaderboard(): Promise<QsrLeaderboard> {
  return learnFetch<QsrLeaderboard>(`${LEARN_FN}?action=leaderboard`);
}

// ── Authoring (Milestone 4 — Course Builder) ─────────────────────────────────
const AUTHOR_FN = "/.netlify/functions/qsr-author";

// AI course authoring — drafts a course from a topic / pasted source (qsr-ai).
export function generateCourse(
  input: { topic: string; sourceText?: string; lessons?: number },
): Promise<{ course_id: string; title: string }> {
  return learnFetch("/.netlify/functions/qsr-ai?action=generate", { method: "POST", body: JSON.stringify(input) });
}


export interface BuilderCourse {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  status: "draft" | "published";
  est_minutes: number | null;
  points: number;
  total_points?: number; // completion points + every quiz card's points
  version: number;
  created_at: string;
  updated_at: string;
  lesson_count: number;
  card_count: number;
}
export interface BuilderCard {
  id: string;
  lesson_id: string;
  ord: number;
  type: CardType;
  data: Record<string, unknown>;
}
export interface BuilderLesson {
  id: string;
  course_id: string;
  title: string;
  module: string | null;
  ord: number;
  cards: BuilderCard[];
}
export interface CourseTree {
  course: BuilderCourse;
  lessons: BuilderLesson[];
}

export function listBuilderCourses(): Promise<{ courses: BuilderCourse[] }> {
  return learnFetch(`${AUTHOR_FN}?action=courses`);
}
export function getCourseTree(courseId: string): Promise<CourseTree> {
  return learnFetch(`${AUTHOR_FN}?action=course&course_id=${encodeURIComponent(courseId)}`);
}
export function saveCourse(
  input: Partial<BuilderCourse> & { title: string },
): Promise<{ course: BuilderCourse }> {
  return learnFetch(`${AUTHOR_FN}?action=saveCourse`, { method: "POST", body: JSON.stringify(input) });
}
export function setCoursePublish(id: string, publish: boolean): Promise<{ course: BuilderCourse }> {
  return learnFetch(`${AUTHOR_FN}?action=setPublish`, { method: "POST", body: JSON.stringify({ id, publish }) });
}
export function deleteBuilderCourse(id: string): Promise<{ ok: true }> {
  return learnFetch(`${AUTHOR_FN}?action=deleteCourse`, { method: "POST", body: JSON.stringify({ id }) });
}
export function saveLesson(
  input: { id?: string; course_id?: string; title: string; module?: string | null; ord?: number },
): Promise<{ lesson: BuilderLesson }> {
  return learnFetch(`${AUTHOR_FN}?action=saveLesson`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteLesson(id: string): Promise<{ ok: true }> {
  return learnFetch(`${AUTHOR_FN}?action=deleteLesson`, { method: "POST", body: JSON.stringify({ id }) });
}
export function saveCard(
  input: { id?: string; lesson_id?: string; type: CardType; data: Record<string, unknown>; ord?: number },
): Promise<{ card: BuilderCard }> {
  return learnFetch(`${AUTHOR_FN}?action=saveCard`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteCard(id: string): Promise<{ ok: true }> {
  return learnFetch(`${AUTHOR_FN}?action=deleteCard`, { method: "POST", body: JSON.stringify({ id }) });
}
export function reorderBuilder(
  table: "cards" | "lessons",
  items: { id: string; ord: number }[],
): Promise<{ ok: true }> {
  return learnFetch(`${AUTHOR_FN}?action=reorder`, { method: "POST", body: JSON.stringify({ table, items }) });
}

// ── Manager dashboard (Milestone 5) ──────────────────────────────────────────
const MANAGE_FN = "/.netlify/functions/qsr-manage";

export interface ManageOverview {
  learners: number;
  publishedCourses: number;
  enrollments: number;
  completions: number;
  completionRate: number;
  totalPoints: number;
}
export interface CourseStat { id: string; title: string; status: string; enrolled: number; completed: number; rate: number }
export interface StoreStat { store_id: string; number: string; name: string; region: string; learners: number; enrolled: number; completed: number; rate: number }
export interface AssignTargets {
  courses: { id: string; title: string; status: string }[];
  stores: { id: string; number: string; name: string; region: string }[];
}
export interface Assignment {
  id: string;
  course_id: string;
  course_title: string;
  scope_type: "all" | "region" | "district" | "store" | "user";
  scope_id: string | null;
  scope_label: string | null;
  due_at: string | null;
  created_at: string;
  total: number;
  completed: number;
}
export interface CompletionRow { learner: string; store: string; region: string; course: string; completed_at: string }

export function fetchManageOverview(): Promise<ManageOverview> {
  return learnFetch(`${MANAGE_FN}?action=overview`);
}
export function fetchByCourse(): Promise<{ courses: CourseStat[] }> {
  return learnFetch(`${MANAGE_FN}?action=byCourse`);
}
export function fetchByStore(): Promise<{ stores: StoreStat[] }> {
  return learnFetch(`${MANAGE_FN}?action=byStore`);
}
export function fetchAssignTargets(): Promise<AssignTargets> {
  return learnFetch(`${MANAGE_FN}?action=targets`);
}
export function fetchAssignments(): Promise<{ assignments: Assignment[] }> {
  return learnFetch(`${MANAGE_FN}?action=assignments`);
}
export function createAssignment(input: {
  course_id: string; scope_type: Assignment["scope_type"]; scope_id?: string | null; scope_label?: string | null; due_at?: string | null;
}): Promise<{ assignment: Assignment }> {
  return learnFetch(`${MANAGE_FN}?action=assign`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteAssignment(id: string): Promise<{ ok: true }> {
  return learnFetch(`${MANAGE_FN}?action=unassign`, { method: "POST", body: JSON.stringify({ id }) });
}
export function fetchCompletions(): Promise<{ rows: CompletionRow[] }> {
  return learnFetch(`${MANAGE_FN}?action=completions`);
}

// ── Course media uploads (Supabase Storage, bucket from migration 0169) ──────
const QSR_MEDIA_BUCKET = "qsr-media";

// Uploads an image/video for a card and returns its public URL (to store in
// the card's videoUrl / imageUrl). Authors only — gated by storage RLS.
export async function uploadQsrMedia(file: File, cardId: string): Promise<string> {
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${cardId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(QSR_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from(QSR_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}
