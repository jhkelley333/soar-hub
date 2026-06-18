// SOAR QSR — Milestone 3 gamification surface: the caller's points + streak +
// badges, and the weekly store leaderboard. All values are server-computed
// from the points ledger (no client-side scoring). Interim placement on the
// admin shell until the Hub home is re-created from the prototype.
import { useQuery } from "@tanstack/react-query";
import { Zap, Flame, Trophy, Rocket, Target, Award } from "lucide-react";
import { fetchQsrStats, fetchQsrLeaderboard } from "./api";

const BADGE_ICON: Record<string, typeof Award> = { rocket: Rocket, target: Target, flame: Flame };

export function GamificationPanel() {
  const statsQ = useQuery({ queryKey: ["qsr", "stats"], queryFn: fetchQsrStats, staleTime: 30_000 });
  const lbQ = useQuery({ queryKey: ["qsr", "leaderboard"], queryFn: fetchQsrLeaderboard, staleTime: 30_000 });
  const s = statsQ.data;
  const lb = lbQ.data;

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      {/* Your progress */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 text-sm font-semibold text-ink">Your progress</div>
        {!s ? (
          <div className="h-20 animate-pulse rounded-xl bg-surface-sunk" />
        ) : (
          <>
            <div className="flex gap-7">
              <div>
                <div className="flex items-center gap-1 font-qsr-display text-2xl font-bold text-ink">
                  <Zap className="h-5 w-5 text-qsr-gold" />{s.points}
                </div>
                <div className="font-qsr-ui text-[11px] uppercase tracking-wide text-ink-subtle">points</div>
              </div>
              <div>
                <div className="flex items-center gap-1 font-qsr-display text-2xl font-bold text-ink">
                  <Flame className={`h-5 w-5 ${s.streak.atRisk ? "text-ink-subtle" : "text-qsr-crimson"}`} />{s.streak.current}
                </div>
                <div className="font-qsr-ui text-[11px] uppercase tracking-wide text-ink-subtle">day streak</div>
              </div>
            </div>
            {s.streak.atRisk && s.streak.current > 0 && (
              <div className="mt-2 inline-block rounded-full bg-qsr-gold/15 px-2.5 py-0.5 text-[11px] font-medium text-qsr-azure">
                Streak at risk — finish a lesson today
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {s.badges.length === 0 ? (
                <span className="font-qsr-ui text-xs text-ink-subtle">No badges yet — finish a lesson to earn your first.</span>
              ) : (
                s.badges.map((b) => {
                  const I = BADGE_ICON[b.icon || ""] || Award;
                  return (
                    <span key={b.key} className="inline-flex items-center gap-1 rounded-full bg-surface-sunk px-2.5 py-1 text-[11px] font-medium text-ink">
                      <I className="h-3.5 w-3.5 text-qsr-azure" />{b.name}
                    </span>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Store leaderboard */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <Trophy className="h-4 w-4 text-qsr-gold" /> Store leaderboard
          <span className="font-qsr-ui text-[11px] font-normal text-ink-subtle">· this week</span>
        </div>
        {!lb ? (
          <div className="h-20 animate-pulse rounded-xl bg-surface-sunk" />
        ) : lb.entries.length === 0 ? (
          <div className="font-qsr-ui text-xs text-ink-subtle">No store set on your profile, or no points yet this week.</div>
        ) : (
          <ol className="space-y-1.5">
            {lb.entries.map((e, i) => (
              <li key={e.user_id} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 ${e.isMe ? "bg-qsr-azure/10" : ""}`}>
                <span className="flex items-center gap-2">
                  <span className="w-5 text-center font-qsr-mono text-xs text-ink-subtle">{i + 1}</span>
                  <span className={`font-qsr-ui text-sm ${e.isMe ? "font-semibold text-qsr-azure" : "text-ink"}`}>
                    {e.name}{e.isMe ? " (you)" : ""}
                  </span>
                </span>
                <span className="font-qsr-mono text-xs font-semibold text-ink">{e.points}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
