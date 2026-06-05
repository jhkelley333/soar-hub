// Walkthrough analytics — fleet trend, section performance, tier mix, top
// problem areas, and a GM leaderboard over the last 8 weeks. Dependency-free
// charts (inline SVG + CSS bars). Read-only; aggregates the RLS-scoped
// submissions client-side (see ./api).

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { cn } from "@/lib/cn";
import { loadAnalytics, type AnalyticsData, type TrendPoint } from "./api";

const C = {
  green: "#10b981",
  yellow: "#f59e0b",
  red: "#ef4444",
  line: "#6366f1",
  grid: "#e5e7eb",
};

function scoreColor(score: number): string {
  if (score >= 85) return C.green;
  if (score >= 70) return C.yellow;
  return C.red;
}

export function AnalyticsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const q = useQuery({ queryKey: ["wt-analytics"], queryFn: loadAnalytics, staleTime: 60_000 });

  return (
    <div className={embedded ? "" : "mx-auto max-w-5xl"}>
      <div className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight text-midnight">Analytics</h2>
        <p className="text-xs text-zinc-500">Trends, leaderboards &amp; problem areas · last 8 weeks</p>
      </div>

      {q.isLoading ? (
        <div className="grid min-h-[30vh] place-items-center text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : q.error ? (
        <Card>
          <CardBody className="text-sm text-red-600">
            {q.error instanceof Error ? q.error.message : "Failed to load analytics."}
          </CardBody>
        </Card>
      ) : !q.data || q.data.totalSubmissions === 0 ? (
        <Card>
          <CardBody className="text-sm text-zinc-500">
            No submissions in the last 8 weeks yet — analytics will populate as walks come in.
          </CardBody>
        </Card>
      ) : (
        <Dashboard data={q.data} />
      )}
    </div>
  );
}

function Dashboard({ data }: { data: AnalyticsData }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Fleet score trend" subtitle="Average across all walkthroughs">
          <TrendChart points={data.trend} />
        </Panel>
        <Panel title="Section performance" subtitle="Fleet avg · lowest first">
          {data.sections.length ? (
            <div className="space-y-2.5">
              {data.sections.map((s) => (
                <BarRow key={s.name} label={s.name} value={s.score} max={100} suffix={String(s.score)} color={scoreColor(s.score)} />
              ))}
            </div>
          ) : (
            <Empty />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Tier mix">
          <TierDonut mix={data.tierMix} />
        </Panel>
        <Panel title="Top problem areas">
          {data.problems.length ? (
            <div className="space-y-2.5">
              {data.problems.map((p) => (
                <BarRow
                  key={p.label}
                  label={p.label}
                  value={p.count}
                  max={data.problems[0].count}
                  suffix={`${p.count}×`}
                  color={p.count >= data.problems[0].count * 0.66 ? C.red : C.yellow}
                />
              ))}
            </div>
          ) : (
            <Empty text="No fails recorded — nice." />
          )}
        </Panel>
        <Panel title="GM leaderboard">
          {data.leaderboard.length ? (
            <ol className="space-y-1.5">
              {data.leaderboard.map((g, i) => (
                <li key={g.name} className="flex items-center gap-3 text-sm">
                  <span className="w-4 text-right font-mono text-xs text-zinc-400">{i + 1}</span>
                  <span className="flex-1 truncate text-midnight">{g.name}</span>
                  <span className="font-semibold tabular-nums" style={{ color: scoreColor(g.score) }}>
                    {g.score}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty />
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <div className="mb-3">
          <div className="text-sm font-semibold text-midnight">{title}</div>
          {subtitle && <div className="text-[11px] text-zinc-500">{subtitle}</div>}
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

function Empty({ text = "Not enough data yet." }: { text?: string }) {
  return <div className="py-6 text-center text-xs text-zinc-400">{text}</div>;
}

function BarRow({
  label,
  value,
  max,
  suffix,
  color,
}: {
  label: string;
  value: number;
  max: number;
  suffix: string;
  color: string;
}) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 truncate text-xs text-zinc-600" title={label}>
        {label}
      </div>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-midnight">{suffix}</div>
    </div>
  );
}

// Fleet score trend — area + line over the weekly buckets. y-domain 60–100.
function TrendChart({ points }: { points: TrendPoint[] }) {
  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.score != null) as {
    label: string;
    score: number;
    i: number;
  }[];
  if (valid.length < 2) {
    return <Empty />;
  }
  const W = 100;
  const H = 56;
  const n = points.length;
  const yMin = 60;
  const yMax = 100;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (s: number) => H - ((Math.min(yMax, Math.max(yMin, s)) - yMin) / (yMax - yMin)) * H;

  const linePts = valid.map((p) => `${x(p.i)},${y(p.score)}`).join(" ");
  const areaPath = `M ${x(valid[0].i)},${H} L ${valid.map((p) => `${x(p.i)},${y(p.score)}`).join(" L ")} L ${x(valid[valid.length - 1].i)},${H} Z`;

  return (
    <div>
      <div className="relative">
        {/* y gridlines at 70 / 80 / 90 */}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full">
          {[70, 80, 90].map((g) => (
            <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke={C.grid} strokeWidth={0.4} />
          ))}
          <path d={areaPath} fill={C.line} opacity={0.08} />
          <polyline points={linePts} fill="none" stroke={C.line} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
          {valid.map((p) => (
            <circle key={p.i} cx={x(p.i)} cy={y(p.score)} r={1.6} fill="#fff" stroke={C.line} strokeWidth={1.2} />
          ))}
        </svg>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
        {points.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

// Tier mix donut.
function TierDonut({ mix }: { mix: { green: number; yellow: number; red: number } }) {
  const total = mix.green + mix.yellow + mix.red;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const segs = [
    { key: "green", value: mix.green, color: C.green },
    { key: "yellow", value: mix.yellow, color: C.yellow },
    { key: "red", value: mix.red, color: C.red },
  ].filter((s) => s.value > 0);

  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-36 w-36">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx={50} cy={50} r={r} fill="none" stroke={C.grid} strokeWidth={12} />
          {segs.map((s) => {
            const len = total ? (s.value / total) * circ : 0;
            const el = (
              <circle
                key={s.key}
                cx={50}
                cy={50}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={12}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-2xl font-bold text-midnight">{total}</span>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px]">
        <Legend color={C.green} label="Green" value={mix.green} />
        <Legend color={C.yellow} label="Yellow" value={mix.yellow} />
        <Legend color={C.red} label="Red" value={mix.red} />
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-600">
      <span className={cn("h-2 w-2 rounded-full")} style={{ background: color }} />
      {label} {value}
    </span>
  );
}
