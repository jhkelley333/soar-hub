// Public (no-login) QR player client. Hits qsr-public with a store token + the
// learner the crew member self-selected — no Supabase session. The returned
// LearnApi is fed to the shared LessonPlayer via LearnApiProvider.
import type { LearnApi } from "../player/LearnApi";
import type { LessonPayload } from "../types";

const PUBLIC_FN = "/.netlify/functions/qsr-public";

async function publicFetch<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${PUBLIC_FN}?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export interface PublicHub {
  store: { id: string; number: string; name: string };
  learners: { id: string; name: string }[];
  courses: { id: string; title: string; category: string | null; est_minutes: number | null; card_count: number; points: number; total_points?: number }[];
}

export function resolveLearnToken(token: string): Promise<PublicHub> {
  return publicFetch("resolve", { token });
}

export function makePublicLearnApi(token: string, learnerId: string): LearnApi {
  return {
    fetchLesson: (courseId, lang = "en") => publicFetch<LessonPayload>("lesson", { token, learnerId, course_id: courseId, lang }),
    recordCardProgress: (cardId, state, watchedPct) =>
      publicFetch("progress", { token, learnerId, card_id: cardId, state, watched_pct: watchedPct }),
    answerQuiz: (cardId, selection, lang = "en") =>
      publicFetch("quiz", {
        token, learnerId, card_id: cardId, lang,
        ...(Array.isArray(selection) ? { answer_indices: selection } : { answer_index: selection }),
      }),
    votePoll: (cardId, optionIndex) => publicFetch("poll", { token, learnerId, card_id: cardId, option_index: optionIndex }),
    completeLesson: (courseId) => publicFetch("complete", { token, learnerId, course_id: courseId }),
  };
}
