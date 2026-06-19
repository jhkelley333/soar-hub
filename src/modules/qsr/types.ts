// SOAR QSR — lesson card data contract (spec §6). Card.data is validated per
// type at the boundary; learner reads have quiz `answer`/`explain` stripped by
// the server, and poll `results` injected server-side.

export type CardType =
  | "intro" | "steps" | "image" | "video" | "quiz" | "reveal" | "poll" | "done";

export interface IntroData {
  kicker?: string; icon?: string; title: string; body?: string;
  meta?: { v: string; k: string }[];
}
export interface StepsData {
  kicker?: string; title: string; steps: { t: string; d?: string }[];
}
export interface ImageData {
  kicker?: string; title: string; body?: string; imageUrl?: string | null;
}
export interface VideoData {
  kicker?: string; title: string; body?: string;
  videoUrl?: string | null;      // YouTube / Vimeo link or a direct .mp4 URL
  lengthSec?: number;            // approx length, used to time-gate embeds
  muxPlaybackId?: string | null; gate?: boolean; threshold?: number;
}
export interface QuizData {
  kicker?: string; points?: number; q: string; options: string[];
  answer?: number;        // correct index (single-select)
  answers?: number[];     // correct indices (when multi)
  multi?: boolean;        // allow selecting more than one
  explain?: string; // stripped for learners
}
export interface RevealData {
  kicker?: string; title: string; reveal: string;
}
export interface PollData {
  kicker?: string; q: string; options: string[]; results?: number[];
}
export interface DoneData {
  title: string; body?: string; points?: number; streak?: number; score?: string;
}

export type CardData =
  | IntroData | StepsData | ImageData | VideoData | QuizData | RevealData | PollData | DoneData;

export interface CardProgress {
  state: "seen" | "answered" | "passed";
  answer_index: number | null;
  correct: boolean | null;
  watched_pct: number | null;
}

export interface LessonCard {
  id: string;
  ord: number;
  type: CardType;
  data: CardData;
  progress: CardProgress | null;
}

export interface LessonPayload {
  course: {
    id: string; title: string; category: string | null; description: string | null;
    status: string; est_minutes: number | null; points: number;
  };
  lesson: { id: string; title: string; module: string | null; ord: number };
  enrollmentId: string;
  cards: LessonCard[];
}
