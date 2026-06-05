// Walkthrough analytics — DO-side trends, leaderboards, and problem areas.
// Direct-to-Supabase: RLS (0120) scopes walkthrough_submissions to the
// caller's visible stores, so we aggregate the last 8 weeks client-side.
// No service-role function needed.

import { supabase } from "@/lib/supabase";
import type { ItemValue, SectionResponse, Tier, WalkthroughTemplate } from "../types";

const WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Earned fraction per answer — mirrors the default scoring map. Used for
// section averages (N/A excluded).
function earned(value: ItemValue): number | null {
  if (value === "pass") return 1;
  if (value === "watch") return 0.6;
  if (value === "fail") return 0;
  return null; // na / null → excluded
}

export interface TrendPoint {
  label: string;
  score: number | null;
}
export interface SectionStat {
  name: string;
  score: number;
}
export interface ProblemArea {
  label: string;
  count: number;
}
export interface LeaderRow {
  name: string;
  score: number;
  count: number;
}
export interface AnalyticsData {
  totalSubmissions: number;
  trend: TrendPoint[];
  tierMix: { green: number; yellow: number; red: number };
  sections: SectionStat[];
  problems: ProblemArea[];
  leaderboard: LeaderRow[];
}

interface SubRow {
  score: number;
  tier: Tier;
  submitted_at: string | null;
  submitted_by: string;
  sections: SectionResponse[];
  submitter: { full_name: string | null; preferred_name: string | null } | null;
}

function submitterName(s: SubRow["submitter"]): string {
  return s?.preferred_name || s?.full_name || "—";
}

export async function loadAnalytics(): Promise<AnalyticsData> {
  const cutoff = new Date(Date.now() - WEEKS * WEEK_MS).toISOString();

  const [{ data: subData, error: subErr }, { data: tmplData }] = await Promise.all([
    supabase
      .from("walkthrough_submissions")
      .select(
        "score, tier, submitted_at, submitted_by, sections, " +
          "submitter:profiles!submitted_by(full_name, preferred_name)",
      )
      .neq("status", "draft")
      .gte("submitted_at", cutoff)
      .order("submitted_at", { ascending: true })
      .limit(2000),
    supabase.from("walkthrough_templates").select("sections"),
  ]);
  if (subErr) throw subErr;
  const subs = (subData ?? []) as unknown as SubRow[];

  // Code → label maps from every template (codes are globally unique enough
  // for a fleet view; first definition wins).
  const sectionName = new Map<string, string>();
  const itemLabel = new Map<string, string>();
  for (const t of (tmplData ?? []) as { sections: WalkthroughTemplate["sections"] }[]) {
    for (const sec of t.sections ?? []) {
      if (!sectionName.has(sec.code)) sectionName.set(sec.code, sec.name || sec.code);
      for (const it of sec.items ?? []) {
        if (!itemLabel.has(it.code)) itemLabel.set(it.code, it.label || it.code);
      }
    }
  }

  // ── Trend: average score per week bucket (W-7 … W-0) ──
  const now = Date.now();
  const bucketSum = new Array(WEEKS).fill(0);
  const bucketN = new Array(WEEKS).fill(0);
  // ── Tier mix ──
  const tierMix = { green: 0, yellow: 0, red: 0 };
  // ── Leaderboard ──
  const byUser = new Map<string, { name: string; sum: number; n: number }>();
  // ── Section averages ──
  const secAgg = new Map<string, { sum: number; n: number }>();
  // ── Problem areas (fail counts) ──
  const failByItem = new Map<string, number>();

  for (const s of subs) {
    if (s.tier in tierMix) tierMix[s.tier] += 1;

    if (s.submitted_at) {
      const age = now - new Date(s.submitted_at).getTime();
      const idx = WEEKS - 1 - Math.floor(age / WEEK_MS);
      if (idx >= 0 && idx < WEEKS) {
        bucketSum[idx] += s.score;
        bucketN[idx] += 1;
      }
    }

    const u = byUser.get(s.submitted_by) ?? { name: submitterName(s.submitter), sum: 0, n: 0 };
    u.sum += s.score;
    u.n += 1;
    byUser.set(s.submitted_by, u);

    for (const sec of s.sections ?? []) {
      for (const it of sec.items ?? []) {
        const e = earned(it.value);
        if (e !== null) {
          const a = secAgg.get(sec.code) ?? { sum: 0, n: 0 };
          a.sum += e;
          a.n += 1;
          secAgg.set(sec.code, a);
        }
        if (it.value === "fail") {
          failByItem.set(it.itemCode, (failByItem.get(it.itemCode) ?? 0) + 1);
        }
      }
    }
  }

  const trend: TrendPoint[] = bucketSum.map((sum, i) => ({
    label: `W-${WEEKS - 1 - i}`,
    score: bucketN[i] ? Math.round(sum / bucketN[i]) : null,
  }));

  const sections: SectionStat[] = [...secAgg.entries()]
    .map(([code, a]) => ({ name: sectionName.get(code) ?? code, score: Math.round((a.sum / a.n) * 100) }))
    .sort((a, b) => a.score - b.score); // lowest first

  const problems: ProblemArea[] = [...failByItem.entries()]
    .map(([code, count]) => ({ label: itemLabel.get(code) ?? code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const leaderboard: LeaderRow[] = [...byUser.values()]
    .map((u) => ({ name: u.name, score: Math.round(u.sum / u.n), count: u.n }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    totalSubmissions: subs.length,
    trend,
    tierMix,
    sections,
    problems,
    leaderboard,
  };
}
