// SOAR QSR — client data access. Reads go straight through supabase-js under
// RLS (published courses are readable by any signed-in user; authors see all).
// Server-authoritative actions (scoring, progress) get Netlify functions in
// later milestones.
import { supabase } from "@/lib/supabase";
import type { LessonPayload } from "./types";

export interface QsrCourseSummary {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  status: "draft" | "published";
  est_minutes: number | null;
  points: number;
  lesson_count: number;
  card_count: number;
}

export async function listQsrCourses(): Promise<QsrCourseSummary[]> {
  const { data, error } = await supabase
    .from("qsr_course_summary")
    .select("id, title, category, description, status, est_minutes, points, lesson_count, card_count")
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
  cardId: string, answerIndex: number,
): Promise<{ ok: true; correct: boolean; pointsAwarded: number; answer: number; explain: string | null }> {
  return learnFetch(`${LEARN_FN}?action=quiz`, {
    method: "POST",
    body: JSON.stringify({ card_id: cardId, answer_index: answerIndex }),
  });
}

export function votePoll(cardId: string, optionIndex: number): Promise<{ ok: true; results: number[] }> {
  return learnFetch(`${LEARN_FN}?action=poll`, {
    method: "POST",
    body: JSON.stringify({ card_id: cardId, option_index: optionIndex }),
  });
}

export function completeLesson(
  courseId: string,
): Promise<{ ok: true; points: number; score: string; streak: number }> {
  return learnFetch(`${LEARN_FN}?action=complete`, {
    method: "POST",
    body: JSON.stringify({ course_id: courseId }),
  });
}
