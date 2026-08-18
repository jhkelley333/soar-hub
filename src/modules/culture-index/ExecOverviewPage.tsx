import { useQuery } from "@tanstack/react-query";
import { Info, TrendingUp, Layers } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { fetchOverview, type OverviewResponse, type HeatCell } from "./analyticsApi";

// Percentile (0–100) → a soft red→green background for heatmap cells.
function heatBg(pct: number): string {
  const h = Math.round((pct / 100) * 135); // 0=red, 135=green
  return `hsl(${h}, 55%, 88%)`;
}

const TIER_TONE: Record<string, string> = {
  Stable: "text-emerald-700",
  Steady: "text-lime-700",
  Volatile: "text-amber-700",
  Turnaround: "text-red-700",
};

export function ExecOverviewPage() {
  const q = useQuery({ queryKey: ["trait-overview"], queryFn: fetchOverview });

  return (
    <>
      <PageHeader
        title="Executive Overview"
        description="Culture Index traits against store performance and stability — what wins, and how much of it is the trait vs. the store."
      />

      {q.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {q.isError && (
        <Card><CardBody>
          <p className="text-sm text-red-600">
            {q.error instanceof Error ? q.error.message : "Couldn't load the overview."}
          </p>
        </CardBody></Card>
      )}

      {q.data && <Overview data={q.data} />}
    </>
  );
}

function Overview({ data }: { data: OverviewResponse }) {
  const { decomposition: d, coverage, run } = data;
  return (
    <div className="space-y-6">
      {/* Coverage strip */}
      <div className="flex flex-wrap gap-2 text-xs text-ink-muted">
        <Badge tone="neutral">Ranker week ending {run.week_ending}</Badge>
        <Badge tone="neutral">{coverage.ranked_stores} ranked stores</Badge>
        <Badge tone={coverage.trait_pct >= 60 ? "success" : "warning"}>
          {coverage.with_trait} have a trait ({coverage.trait_pct}%)
        </Badge>
      </div>

      {/* THE HEADLINE — stability vs. trait */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-accent" strokeWidth={2} />
              What's actually driving performance?
            </span>
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Driver label="Store stability" pct={d.stability_r2} hint="variance in rank explained" lead={d.verdict === "stability"} />
            <Driver label="Culture Index trait" pct={d.trait_var} hint="variance in rank explained" lead={d.verdict === "trait"} />
          </div>
          <p className="mt-4 rounded-lg bg-accent/5 px-3 py-2.5 text-sm leading-relaxed text-ink-muted">
            {verdictText(d)}
          </p>
        </CardBody>
      </Card>

      {/* Leaderboard */}
      <Card>
        <CardHeader
          title="Trait performance"
          description={`Average store performance percentile by GM trait. Only traits with ${data.thresholds.min_n_trait}+ GMs are ranked — the rest don't have enough signal yet.`}
        />
        <CardBody className="p-0">
          {data.leaderboard.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted">
              No trait has {data.thresholds.min_n_trait}+ ranked GMs yet — import more Culture Index
              results before drawing conclusions.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Trait</th>
                    <th className="px-4 py-2 text-right font-medium">GMs</th>
                    <th className="px-4 py-2 text-right font-medium">Avg pct</th>
                    <th className="px-4 py-2 text-right font-medium">Median</th>
                    <th className="px-4 py-2 text-right font-medium">Spread</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.leaderboard.map((e) => (
                    <tr key={e.trait}>
                      <td className="px-4 py-2 font-medium text-heading">{e.trait}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{e.n}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-heading">{e.mean}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{e.median}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">±{e.spread}</td>
                      <td className="px-4 py-2">
                        <span className="inline-block h-1.5 rounded-full bg-accent/70" style={{ width: `${Math.max(4, e.mean)}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.thin_traits.length > 0 && (
            <div className="border-t border-border px-4 py-3">
              <p className="text-xs text-ink-muted">
                <span className="font-medium text-heading">Not enough signal yet</span>{" "}
                (under {data.thresholds.min_n_trait} GMs — shown, not ranked):{" "}
                {data.thin_traits.map((t) => `${t.trait} (n=${t.n})`).join(", ")}.
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Heatmap — the interaction */}
      {data.heatmap.length > 0 && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-accent" strokeWidth={2} />
                Trait × store stability
              </span>
            }
            description="Average performance percentile for each trait, split by how stable the store is. This is the placement lever — which trait holds up where. Cells with fewer than 4 GMs are left blank."
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto px-4 pb-4">
              <table className="min-w-[34rem] border-separate" style={{ borderSpacing: "4px" }}>
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left text-xs font-medium text-ink-muted"></th>
                    {data.tier_distribution.map((t) => (
                      <th key={t.tier} className={`px-2 py-1 text-center text-xs font-semibold ${TIER_TONE[t.tier]}`}>
                        {t.tier}
                        <span className="block text-[10px] font-normal text-zinc-400">n={t.n}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.heatmap.map((row) => (
                    <tr key={row.trait}>
                      <td className="whitespace-nowrap px-2 py-1 text-right text-xs font-medium text-heading">{row.trait}</td>
                      {row.cells.map((c) => (
                        <HeatTd key={c.tier} c={c} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-zinc-400">
                Higher = better performance percentile. Read across a row: does this trait do better
                in stable stores, or hold up in turnaround stores?
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Caveats */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5 text-[11px] leading-relaxed text-ink-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
        <span>
          This is directional, not causal. Performance is confounded by market, tenure, and
          district; trait samples are small; and a trait is a <em>default</em>, not a verdict on a
          person. Use it to form hypotheses and guide placement — not to hire, fire, or rank people.
        </span>
      </div>
    </div>
  );
}

function Driver({ label, pct, hint, lead }: { label: string; pct: number; hint: string; lead: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${lead ? "border-accent/50 bg-accent/5" : "border-border bg-surface"}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-heading">{label}</span>
        {lead && <Badge tone="info" className="text-[10px]">Bigger lever</Badge>}
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-heading">{pct}%</div>
      <div className="text-[11px] text-ink-muted">{hint}</div>
      <div className="mt-2 h-1.5 rounded-full bg-surface-muted">
        <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function HeatTd({ c }: { c: HeatCell }) {
  if (!c.confident || c.mean == null) {
    return (
      <td className="rounded px-2 py-2 text-center text-[11px] text-zinc-400" style={{ background: "var(--surface-muted, #f4f4f5)" }}>
        {c.n === 0 ? "—" : `n=${c.n}`}
      </td>
    );
  }
  return (
    <td className="rounded px-2 py-2 text-center text-xs font-semibold tabular-nums" style={{ background: heatBg(c.mean), color: "#14202e" }}>
      {c.mean}
      <span className="block text-[10px] font-normal opacity-60">n={c.n}</span>
    </td>
  );
}

function verdictText(d: OverviewResponse["decomposition"]): string {
  if (d.verdict === "thin") {
    return `Only ${d.n} stores have both a GM trait and a performance rank — too few to separate the trait's effect from the store's. Import more Culture Index results, then revisit.`;
  }
  if (d.verdict === "stability") {
    return `Store stability explains more of the performance spread than trait does (${d.stability_r2}% vs. ${d.trait_var}%). The lever here is stabilizing stores — tenure and turnover — first; trait is a secondary optimization, best used for placement once a store is settled.`;
  }
  if (d.verdict === "trait") {
    return `Trait tracks performance more than stability does here (${d.trait_var}% vs. ${d.stability_r2}%) — worth a close look at the leaderboard and the trait × stability grid below before acting.`;
  }
  return `Stability (${d.stability_r2}%) and trait (${d.trait_var}%) explain similar, modest shares of the performance spread — neither dominates. Treat both as weak signals and lean on the interaction grid, not the headline number.`;
}
