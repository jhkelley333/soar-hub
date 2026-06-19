// SOAR QSR — lesson player shell. Sequences cards, renders the top chrome
// (close + segmented progress + running points), a left-edge back-tap, and a
// slide-in per card. Server-authoritative: cards report to the API; the shell
// only advances and shows the running points the server awarded.
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { X, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { LessonCard } from "../types";
import { useLearnApi } from "./LearnApi";
import {
  IntroCard, StepsCard, ImageCard, VideoCard, QuizCard, RevealCard, PollCard, DoneCard,
} from "./LessonCards";

const DARK_TYPES = new Set(["intro", "video", "done"]);

function Seg({ total, filled, dark }: { total: number; filled: number; dark: boolean }) {
  return (
    <div className="flex flex-1 gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1 flex-1 rounded-full ${
            i < filled ? (dark ? "bg-white" : "bg-qsr-azure") : dark ? "bg-white/25" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}

export function LessonPlayer({ courseId: courseIdProp, onExit }: { courseId?: string; onExit?: () => void } = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const { fetchLesson, recordCardProgress } = useLearnApi();
  const courseId = courseIdProp ?? params.courseId ?? "";
  const [index, setIndex] = useState(0);
  const [points, setPoints] = useState(0);
  const [lang, setLang] = useState("en");

  const lessonQ = useQuery({
    queryKey: ["qsr", "lesson", courseId, lang],
    queryFn: () => fetchLesson(courseId, lang),
    enabled: !!courseId,
    placeholderData: (prev) => prev, // keep current cards visible while toggling language
  });
  const cards: LessonCard[] = useMemo(() => lessonQ.data?.cards ?? [], [lessonQ.data]);
  const languages = lessonQ.data?.course.languages ?? ["en"];
  const hasEs = languages.includes("es");

  // Seed running points from any quiz already answered correctly.
  useEffect(() => {
    if (!lessonQ.data) return;
    let p = 0;
    for (const c of lessonQ.data.cards) {
      if (c.type === "quiz" && c.progress?.correct) p += Number((c.data as { points?: number }).points ?? 10);
    }
    setPoints(p);
  }, [lessonQ.data]);

  const exit = onExit ?? (() => navigate("/qsr"));
  const card = cards[index];
  const dark = card ? DARK_TYPES.has(card.type) : true;

  const advance = (c: LessonCard) => {
    if (c.type !== "video") recordCardProgress(c.id, "seen").catch(() => {});
    setIndex((i) => Math.min(i + 1, cards.length - 1));
  };
  const back = () => setIndex((i) => Math.max(i - 1, 0));

  const renderCard = (c: LessonCard) => {
    const common = { card: c, onAdvance: () => advance(c), onPoints: (delta: number) => setPoints((p) => p + delta), lang };
    switch (c.type) {
      case "intro": return <IntroCard {...common} />;
      case "steps": return <StepsCard {...common} />;
      case "image": return <ImageCard {...common} />;
      case "video": return <VideoCard {...common} />;
      case "quiz": return <QuizCard {...common} />;
      case "reveal": return <RevealCard {...common} />;
      case "poll": return <PollCard {...common} />;
      case "done": return <DoneCard card={c} courseId={courseId} onFinish={exit} />;
      default: return null;
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-7rem)] items-center justify-center">
      <div className="relative mx-auto h-[78vh] max-h-[780px] min-h-[560px] w-full max-w-[420px] overflow-hidden rounded-[32px] bg-white shadow-xl ring-1 ring-black/10">
        {/* top chrome */}
        {card && card.type !== "done" && (
          <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 px-4 py-3">
            <button
              type="button" onClick={exit} aria-label="Close lesson"
              className={`flex h-7 w-7 items-center justify-center rounded-full transition active:scale-95 ${
                dark ? "bg-white/15 text-white" : "bg-surface-sunk text-ink-muted"
              }`}
            >
              <X className="h-4 w-4" />
            </button>
            <Seg total={cards.length} filled={index} dark={dark} />
            {hasEs && (
              <div className={`flex shrink-0 overflow-hidden rounded-full text-[10px] font-bold ${dark ? "bg-white/15" : "bg-surface-sunk"}`}>
                {(["en", "es"] as const).map((l) => (
                  <button
                    key={l} type="button" onClick={() => setLang(l)}
                    className={`px-2 py-0.5 uppercase transition ${
                      lang === l ? "bg-qsr-azure text-white" : dark ? "text-white/70" : "text-ink-muted"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            <span className={`flex items-center gap-1 font-qsr-mono text-xs font-semibold ${dark ? "text-white" : "text-ink"}`}>
              <Zap className="h-3.5 w-3.5 text-qsr-gold" />{points}
            </span>
          </div>
        )}

        {/* left-edge back-tap */}
        {index > 0 && card?.type !== "done" && (
          <button type="button" onClick={back} aria-label="Previous card" className="absolute inset-y-0 left-0 z-10 w-8" />
        )}

        {/* card */}
        {lessonQ.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-subtle">Loading lesson…</div>
        ) : lessonQ.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-7 text-center">
            <p className="text-sm text-ink-muted">{(lessonQ.error as Error)?.message || "Couldn't load this lesson."}</p>
            <button type="button" onClick={exit} className="text-sm font-semibold text-qsr-azure">Back to SOAR QSR</button>
          </div>
        ) : card ? (
          <div key={index} className="qsr-card-in h-full">{renderCard(card)}</div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-subtle">No cards in this lesson.</div>
        )}
      </div>
    </div>
  );
}
