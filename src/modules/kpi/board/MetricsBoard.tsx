// Execution Metrics Board — pixel-accurate port of the design handoff. A fixed
// 1440px dark "wall display": six pillars, each with a Metric That Matters and
// its execution metrics, a Daily/WTD/MTD toggle, sparklines, and a trailing
// 5-week strip. Scope-selectable (company / region / store). Live values come
// from kpi-board; targets/units from the static catalog. Unwired metrics render
// in a skeleton state.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { PILLARS, C, MONO, SANS, type MetricDef, type Pillar } from "./catalog";
import { fetchKpiBoard, type MetricValues } from "./api";
import { metricView, PERIOD_LABELS, type MetricView, type Period } from "./logic";

const box = (s: CSSProperties): CSSProperties => s;

function Sparkline({ v, w, h, sw, r }: { v: MetricView; w: number; h: number; sw: number; r: number }) {
  if (!v.spark) return <svg width={w} height={h} style={{ display: "block" }} />;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: "block" }}>
      <path d={v.spark} fill="none" stroke={v.sparkColor} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={v.dotX} cy={v.dotY} r={r} fill={v.sparkColor} />
    </svg>
  );
}

function WeekStrip({ v, dir }: { v: MetricView; dir: "row" | "grid" }) {
  if (!v.weeks.length) return null;
  return (
    <div style={box({ display: dir === "grid" ? "grid" : "flex", gridTemplateColumns: dir === "grid" ? "repeat(5,1fr)" : undefined, gap: 9 })}>
      {v.weeks.map((w) => (
        <div key={w.label} style={box({ display: "flex", flexDirection: "column", gap: 1, alignItems: dir === "grid" ? "center" : "flex-start" })}>
          <span style={box({ fontSize: 9.5, fontWeight: 600, color: C.faint })}>{w.label}</span>
          <span style={box({ fontFamily: MONO, fontSize: 11, color: C.tertiary })}>{w.value}</span>
        </div>
      ))}
    </div>
  );
}

function MtmPanel({ p, v }: { p: Pillar; v: MetricView }) {
  return (
    <div style={box({ background: C.inset, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: p.key === "sales" ? 16 : "14px 16px", display: "flex", flexDirection: "column", gap: 8 })}>
      <div style={box({ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.accent })}>Metric That Matters</div>
      <div style={box({ fontSize: 12.5, color: C.tertiary })}>{v.name}</div>
      <div style={box({ display: "flex", alignItems: "flex-end", gap: 9 })}>
        <span style={box({ fontFamily: MONO, fontWeight: 600, fontSize: p.mtmSize, lineHeight: 0.95, letterSpacing: "-.02em", color: C.primary })}>{v.value}</span>
        {v.delta && <span style={box({ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, paddingBottom: 5, color: v.deltaColor })}>{v.delta}</span>}
      </div>
      <div style={box({ fontSize: 11, color: C.dim })}>{v.targetLabel}</div>
      <Sparkline v={v} w={p.spark[0]} h={p.spark[1]} sw={2} r={3} />
      <div style={box({ borderTop: `1px solid ${C.divider}`, paddingTop: 9 })}>
        <WeekStrip v={v} dir="grid" />
      </div>
    </div>
  );
}

function MtmBanner({ p, v }: { p: Pillar; v: MetricView }) {
  return (
    <div style={box({ background: C.inset, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 })}>
      <div style={box({ display: "flex", flexDirection: "column", gap: 6 })}>
        <div style={box({ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.accent })}>Metric That Matters</div>
        <div style={box({ fontSize: 12.5, color: C.tertiary })}>{v.name}</div>
        <div style={box({ display: "flex", alignItems: "flex-end", gap: 9 })}>
          <span style={box({ fontFamily: MONO, fontWeight: 600, fontSize: p.mtmSize, lineHeight: 0.95, letterSpacing: "-.02em", color: C.primary })}>{v.value}</span>
          {v.delta && <span style={box({ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, paddingBottom: 4, color: v.deltaColor })}>{v.delta}</span>}
        </div>
        <div style={box({ fontSize: 11, color: C.dim })}>{v.targetLabel}</div>
      </div>
      <div style={box({ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 })}>
        <Sparkline v={v} w={p.spark[0]} h={p.spark[1]} sw={2} r={3} />
        <WeekStrip v={v} dir="row" />
      </div>
    </div>
  );
}

function ExecRow({ def, v, team }: { def: MetricDef; v: MetricView; team: boolean }) {
  return (
    <div style={box({
      display: "grid", gridTemplateColumns: team ? "1fr 70px" : "1fr 78px 66px 104px", alignItems: "center", gap: 12,
      padding: "9px 12px", borderRadius: 8, background: C.inset, border: `1px solid ${C.borderSubtle}`, borderLeft: `2px solid ${v.statusColor}`,
    })}>
      <div style={box({ minWidth: 0 })}>
        <div style={box({ fontSize: 12.5, fontWeight: 500, color: C.secondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" })}>{def.name}</div>
        <div style={box({ fontSize: 10.5, color: C.faint })}>{v.targetLabel}</div>
      </div>
      {team ? (
        <div style={box({ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 })}>
          <span style={box({ fontFamily: MONO, fontSize: 15, fontWeight: 600, color: C.primary })}>{v.value}</span>
          {v.delta && <span style={box({ fontFamily: MONO, fontSize: 11, color: v.deltaColor })}>{v.delta}</span>}
        </div>
      ) : (
        <>
          <span style={box({ fontFamily: MONO, fontSize: 15, fontWeight: 600, textAlign: "right", color: C.primary })}>{v.value}</span>
          <span style={box({ fontFamily: MONO, fontSize: 11.5, fontWeight: 500, textAlign: "right", color: v.deltaColor })}>{v.delta}</span>
          <Sparkline v={v} w={104} h={26} sw={1.5} r={2} />
        </>
      )}
    </div>
  );
}

function PillarCard({ p, values, period }: { p: Pillar; values: Record<string, MetricValues>; period: Period }) {
  const mtmV = metricView(p.mtm, values[p.mtm.id], period, p.spark[0], p.spark[1]);
  const rowViews = p.rows.map((r) => ({ def: r, v: metricView(r, values[r.id], period, 104, 26) }));
  return (
    <section style={box({ gridColumn: `span ${p.span}`, background: C.card, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: "18px 20px", display: "flex", flexDirection: "column", gap: p.key === "sales" ? 16 : 14 })}>
      <div style={box({ display: "flex", alignItems: "baseline", gap: 10, justifyContent: p.countLabel ? "space-between" : "flex-start" })}>
        <div style={box({ display: "flex", alignItems: "baseline", gap: 10 })}>
          <span style={box({ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: C.accent })}>{p.index}</span>
          <span style={box({ fontSize: 17, fontWeight: 700, letterSpacing: "-.01em", color: C.primary })}>{p.title}</span>
        </div>
        {p.countLabel && <span style={box({ fontSize: 10.5, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: C.dim })}>{p.countLabel}</span>}
      </div>
      {p.mtmStyle === "panel" ? <MtmPanel p={p} v={mtmV} /> : <MtmBanner p={p} v={mtmV} />}
      <div style={box({ display: p.rowStyle === "grid2" ? "grid" : "flex", gridTemplateColumns: p.rowStyle === "grid2" ? "repeat(2,1fr)" : undefined, flexDirection: p.rowStyle === "grid2" ? undefined : "column", gap: 8 })}>
        {rowViews.map(({ def, v }) => <ExecRow key={def.id} def={def} v={v} team={p.rowStyle === "team"} />)}
      </div>
    </section>
  );
}

const btn = (sel: boolean): CSSProperties => ({
  fontSize: 12.5, fontWeight: 600, letterSpacing: ".02em", padding: "8px 16px", border: 0, borderRadius: 6, cursor: "pointer",
  background: sel ? C.accent : "transparent", color: sel ? C.onAccent : C.inactive,
});
const selStyle: CSSProperties = { background: C.inset, color: C.tertiary, border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "7px 10px", fontSize: 12.5, fontFamily: SANS };

export function MetricsBoard() {
  const [period, setPeriod] = useState<Period>("wtd");
  const [level, setLevel] = useState<"company" | "region" | "store">("company");
  const [id, setId] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["kpi-board", level, id], queryFn: () => fetchKpiBoard(level, id) });
  const data = q.data;
  const values = data?.values ?? {};

  // On-target counter across every metric (MTMs included).
  let total = 0, good = 0;
  for (const p of PILLARS) for (const m of [p.mtm, ...p.rows]) {
    const v = metricView(m, values[m.id], period, 10, 10);
    if (v.hasData) { total++; if (v.onTarget) good++; }
  }

  const per = PERIOD_LABELS[period];
  const dateLabel = data?.anchor ? new Date(`${data.anchor}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "—";
  const fiscalLabel = data?.fiscal ? `Period ${data.fiscal.period}, Week ${data.fiscal.weekInPeriod}` : "";

  return (
    <div style={box({ background: C.page, borderRadius: 12, overflowX: "auto" })}>
      <div style={box({ width: 1440, minWidth: 1440, padding: "26px 28px 44px", display: "flex", flexDirection: "column", gap: 16, fontFamily: SANS, color: C.primary })}>
        {/* Header */}
        <div style={box({ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, paddingBottom: 16, borderBottom: `1px solid ${C.borderStrong}` })}>
          <div style={box({ display: "flex", flexDirection: "column", gap: 6 })}>
            <div style={box({ fontSize: 11, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase", color: C.dim })}>Operations Hub · Metrics That Matter</div>
            <div style={box({ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1 })}>Execution Metrics Board</div>
            <div style={box({ fontSize: 13, color: C.muted })}>{dateLabel}{fiscalLabel ? ` · ${fiscalLabel}` : ""} · comparison: {per.compare}</div>
          </div>
          <div style={box({ display: "flex", alignItems: "center", gap: 18 })}>
            {/* Scope selector */}
            <div style={box({ display: "flex", gap: 6 })}>
              <select value={level} onChange={(e) => { setLevel(e.target.value as typeof level); setId(null); }} style={selStyle}>
                <option value="company">Company</option>
                <option value="region">Region</option>
                <option value="store">Store</option>
              </select>
              {level === "region" && (
                <select value={id ?? ""} onChange={(e) => setId(e.target.value || null)} style={selStyle}>
                  <option value="">All regions…</option>
                  {(data?.scopes.regions ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              {level === "store" && (
                <select value={id ?? ""} onChange={(e) => setId(e.target.value || null)} style={selStyle}>
                  <option value="">Pick a store…</option>
                  {(data?.scopes.stores ?? []).map((s) => <option key={s.number} value={s.number}>#{s.number} · {s.name}</option>)}
                </select>
              )}
            </div>
            <div style={box({ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 })}>
              <span style={box({ fontFamily: MONO, fontSize: 20, fontWeight: 600 })}>{good} / {total}</span>
              <span style={box({ fontSize: 10.5, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: C.dim })}>Metrics on target</span>
            </div>
            <div style={box({ display: "flex", gap: 4, padding: 4, background: C.card, border: `1px solid ${C.borderStrong}`, borderRadius: 9 })}>
              {(["daily", "wtd", "mtd"] as Period[]).map((pk) => (
                <button key={pk} onClick={() => setPeriod(pk)} style={btn(period === pk)}>{pk === "daily" ? "Daily" : pk === "wtd" ? "WTD" : "MTD"}</button>
              ))}
            </div>
          </div>
        </div>

        {q.isLoading && <Skeleton className="h-96 w-full" />}
        {q.isError && <div style={box({ color: C.bad, fontSize: 13 })}>{(q.error as Error)?.message ?? "Couldn't load."}</div>}
        {data && data.anchor == null && <EmptyState title="No data yet" description="No labor snapshot has been captured." />}

        {data && data.anchor && (
          <>
            <div style={box({ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 16, alignItems: "start" })}>
              {PILLARS.map((p) => <PillarCard key={p.key} p={p} values={values} period={period} />)}
            </div>
            {/* Footer legend */}
            <div style={box({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, paddingTop: 14, borderTop: `1px solid ${C.borderStrong}`, fontSize: 11.5, color: C.faint })}>
              <div style={box({ display: "flex", gap: 18 })}>
                {[[C.good, "On or above target"], [C.accent, "Within 5% of target"], [C.bad, "Off target"]].map(([sw, label]) => (
                  <span key={label} style={box({ display: "flex", alignItems: "center", gap: 6 })}>
                    <span style={box({ width: 8, height: 8, borderRadius: 2, background: sw })} />{label}
                  </span>
                ))}
                <span>Sparkline = trailing 5 weeks</span>
              </div>
              <div>Deltas compare {per.label} to {per.compare}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
