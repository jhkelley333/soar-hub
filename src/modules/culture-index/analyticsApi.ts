// Client for netlify/functions/trait-analytics — the Executive Overview.

import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/trait-analytics";

export interface LeaderboardEntry {
  trait: string;
  n: number;
  mean: number;
  median: number;
  spread: number;
  confident: boolean;
}
export interface HeatCell {
  tier: string;
  n: number;
  mean: number | null;
  confident: boolean;
}
export interface OverviewResponse {
  run: { weeks_analyzed: number };
  coverage: { ranked_stores: number; with_trait: number; trait_pct: number };
  decomposition: {
    stability_r2: number;
    trait_var: number;
    n: number;
    verdict: "stability" | "trait" | "mixed" | "thin";
  };
  leaderboard: LeaderboardEntry[];
  thin_traits: { trait: string; n: number; mean: number }[];
  heatmap: { trait: string; cells: HeatCell[] }[];
  tier_distribution: { tier: string; n: number; mean_percentile: number | null }[];
  thresholds: { min_n_trait: number; min_n_cell: number };
}

export async function fetchOverview(): Promise<OverviewResponse> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`${FN}?action=overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<OverviewResponse>;
}
