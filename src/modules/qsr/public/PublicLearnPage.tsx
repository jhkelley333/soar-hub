// Public no-login QR player. A crew member scans their store's code, lands
// here, taps their name from the store roster, picks a course, and plays it —
// completion records against their real profile (so it flows into the manager
// dashboard). No Supabase session; everything is token + self-selected learner.
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Loader2, Play, Search, Sparkles } from "lucide-react";
import { resolveLearnToken, makePublicLearnApi, type PublicHub } from "./api";
import { LearnApiProvider } from "../player/LearnApi";
import { LessonPlayer } from "../player/LessonPlayer";

export function PublicLearnPage() {
  const { token = "" } = useParams();
  const [learner, setLearner] = useState<{ id: string; name: string } | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const hubQ = useQuery({ queryKey: ["qsr", "public", token], queryFn: () => resolveLearnToken(token), enabled: !!token, retry: false });

  // Stable api object so the player's effects don't re-fire.
  const api = useMemo(() => (learner ? makePublicLearnApi(token, learner.id) : null), [token, learner]);

  if (hubQ.isLoading) return <Centered><Loader2 className="h-6 w-6 animate-spin text-qsr-azure" /></Centered>;
  if (hubQ.isError || !hubQ.data) {
    return <Centered><p className="font-qsr-ui text-sm text-ink-muted">{(hubQ.error as Error)?.message || "This training link isn't available."}</p></Centered>;
  }
  const hub: PublicHub = hubQ.data;

  // Playing a course.
  if (learner && courseId && api) {
    return (
      <div className="min-h-screen bg-qsr-azure/5">
        <LearnApiProvider value={api}>
          <LessonPlayer courseId={courseId} onExit={() => setCourseId(null)} />
        </LearnApiProvider>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* brand hero */}
      <div className="bg-qsr-azure px-6 py-8 text-white">
        <div className="mx-auto flex max-w-md items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-white/70">
          <Sparkles className="h-4 w-4 text-qsr-gold" /> Soar MyLearning · Training
        </div>
        <h1 className="mx-auto mt-2 max-w-md font-qsr-display text-2xl font-bold">{hub.store.number} — {hub.store.name}</h1>
        {learner && <p className="mx-auto mt-1 max-w-md font-qsr-ui text-sm text-white/85">Hi {learner.name.split(" ")[0]} 👋 Pick a course to start.</p>}
      </div>

      <div className="mx-auto max-w-md px-5 py-6">
        {!learner ? (
          <>
            <h2 className="mb-3 font-qsr-display text-lg font-semibold text-ink">Who are you?</h2>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your name…"
                className="block w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 font-qsr-ui text-sm text-ink focus:border-qsr-azure focus:outline-none focus:ring-1 focus:ring-qsr-azure"
              />
            </div>
            <div className="space-y-1.5">
              {hub.learners
                .filter((l) => l.name.toLowerCase().includes(search.trim().toLowerCase()))
                .map((l) => (
                  <button
                    key={l.id} type="button" onClick={() => setLearner(l)}
                    className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-left font-qsr-ui text-[15px] font-semibold text-ink transition hover:border-qsr-azure hover:bg-qsr-azure/5"
                  >
                    <GraduationCap className="h-4 w-4 text-qsr-azure" /> {l.name}
                  </button>
                ))}
              {hub.learners.length === 0 && <p className="font-qsr-ui text-sm text-ink-muted">No crew are mapped to this store yet.</p>}
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-qsr-display text-lg font-semibold text-ink">Courses</h2>
              <button type="button" onClick={() => { setLearner(null); setSearch(""); }} className="font-qsr-ui text-xs font-semibold text-qsr-azure hover:underline">Not {learner.name.split(" ")[0]}?</button>
            </div>
            <div className="space-y-2.5">
              {hub.courses.map((c) => (
                <button
                  key={c.id} type="button" onClick={() => setCourseId(c.id)}
                  className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 text-left transition hover:border-qsr-azure hover:shadow-sm"
                >
                  <div className="min-w-0">
                    {c.category && <div className="text-[11px] font-semibold uppercase tracking-wider text-qsr-crimson">{c.category}</div>}
                    <div className="truncate font-qsr-display text-base font-semibold text-ink">{c.title}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 font-qsr-mono text-[11px] text-ink-muted">
                      <span>{c.card_count} cards</span>
                      {c.est_minutes != null && <span>{c.est_minutes} min</span>}
                      <span>+{c.total_points ?? c.points} pts</span>
                    </div>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-qsr-azure text-white"><Play className="h-4 w-4 fill-white" /></span>
                </button>
              ))}
              {hub.courses.length === 0 && <p className="font-qsr-ui text-sm text-ink-muted">No published courses yet. Check back soon.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-surface p-6 text-center">{children}</div>;
}
