// Team Pipeline — Talent Planning. A scoped Company → District → Store
// drill-down on the viewer's RLS-scoped org tree (fetchMyTree), overlaid with
// talent roll-ups (flight risk, roster size, open reqs) from team-pipeline.js.
// The richer store layouts (bench ladder, 9-box, staffing planner) and the
// GM bench / corrective-action documents build out in later slices.
//
// Gated behind the `team_pipeline` feature flag (see router + nav).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarCheck2, Check, ChevronRight, Lock, SlidersHorizontal, Upload, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Segmented } from "@/shared/ui/Segmented";
import { useToast } from "@/shared/ui/Toaster";
import { fetchMyTree } from "@/modules/my-stores/api";
import type { MyDistrictNode, MyStoreNode } from "@/modules/my-stores/types";
import { fetchGms, fetchRollup, fetchSuccession, fetchStoreRoster, fetchSnapshots, fetchSnapshotRows, fetchRiskReview, fetchDevRollup, fetchReadinessRollup, fetchTenureRollup, fetchTalentExport, fetchMonthlyReview, markReviewed, takeSnapshot, lockSnapshot, seedFromProfiles, commitPlan, updateReq, updateMember, mergeMembers, fetchSettings, updateSettings } from "./api";
import { AccountBadge, MemberDrawerProvider, useMemberDrawer } from "./MemberDrawer";
import { RosterImport } from "./RosterImport";
import { toCSV, downloadCSV } from "@/lib/csv";
import {
  ASPIRATION_META, LADDER, LADDER_BY_KEY, READINESS_BAND_META, READINESS_META, REQ_STATUS_META, RISK_META, ROLE_MIX, roleBelow,
  SIGNAL_SEVERITY_META,
  type Aspiration, type AtRiskMember, type DevGapRow, type DevGoalRow, type DevRollupResponse, type GmSeat, type LadderKey,
  type ReadinessRow, type Requisition, type ReviewView, type RiskCounts, type RiskReviewRow,
  type RollupResponse, type SnapshotRow, type StoreRollup, type SuccessionResponse, type TalentExportResponse,
  type TeamMember, type TenureMember, type TenureRollupResponse,
} from "./types";

type Nav =
  | { level: "company" }
  | { level: "district"; districtId: string }
  | { level: "store"; districtId: string; storeId: string };

const ZERO: StoreRollup = { risk: { immediate: 0, medium: 0, low: 0, na: 0 }, roster: 0, non_gm: 0, open_reqs: 0, gm_risk: null, sales: null, target: null };
const RISK_RANK: Record<TeamMember["flight_risk"], number> = { na: 0, low: 1, medium: 2, immediate: 3 };

type TopView = "pipeline" | "succession" | "development" | "tenure";

export function TeamPipelinePage() {
  const [nav, setNav] = useState<Nav>({ level: "company" });
  const [view, setView] = useState<TopView>("pipeline");
  const treeQ = useQuery({ queryKey: ["my-tree"], queryFn: fetchMyTree, staleTime: 5 * 60_000 });
  const rollupQ = useQuery({ queryKey: ["tp-rollup"], queryFn: fetchRollup, staleTime: 60_000 });
  const roll = rollupQ.data?.stores ?? {};

  const districts = useMemo<MyDistrictNode[]>(() => {
    const regions = treeQ.data?.regions ?? [];
    return regions.flatMap((r) => r.areas ?? []).flatMap((a) => a.districts ?? []);
  }, [treeQ.data]);

  // Region name + DO name per district, for the upgraded district cards. DO is
  // shared across a district's stores, so the first store's leadership wins.
  const districtMeta = useMemo(() => {
    const meta = new Map<string, { regionName: string | null; doName: string | null }>();
    const leadership = treeQ.data?.leadership ?? {};
    for (const region of treeQ.data?.regions ?? []) {
      for (const area of region.areas ?? []) {
        for (const d of area.districts ?? []) {
          const doPerson = d.stores.map((s) => leadership[s.id]?.do).find(Boolean) ?? null;
          meta.set(d.id, {
            regionName: region.name || area.name || null,
            doName: doPerson ? (doPerson.preferred_name || doPerson.full_name || null) : null,
          });
        }
      }
    }
    return meta;
  }, [treeQ.data]);

  const district = districts.find((d) => d.id === (nav as { districtId?: string }).districtId) ?? null;
  const store = district?.stores.find((s) => s.id === (nav as { storeId?: string }).storeId) ?? null;

  if (treeQ.isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (treeQ.isError) {
    return <EmptyState title="Couldn't load your org" description={(treeQ.error as Error)?.message ?? "Try again in a moment."} />;
  }

  return (
    <MemberDrawerProvider canWrite={rollupQ.data?.can_write ?? false} roleEdit={rollupQ.data?.role_edit ?? false}>
      <div className="mx-auto max-w-[1100px]">
        {view === "pipeline" && <Breadcrumb nav={nav} district={district} store={store} onGo={setNav} />}

        <div className="mb-4">
          <Segmented<TopView>
            value={view}
            onChange={setView}
            options={[{ value: "pipeline", label: "Pipeline" }, { value: "succession", label: "Succession & Risk" }, { value: "development", label: "Development" }, { value: "tenure", label: "Time in role" }]}
          />
        </div>

        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-medium text-amber-800">
          <Lock className="h-4 w-4 shrink-0" />
          Talent Planning pilot — gated by the <code className="rounded bg-amber-100 px-1 font-mono text-[12px]">team_pipeline</code> flag.
        </div>

        {view === "succession" ? (
          <SuccessionView districtMeta={districtMeta} districts={districts} />
        ) : view === "development" ? (
          <DevelopmentView districts={districts} districtMeta={districtMeta} />
        ) : view === "tenure" ? (
          <TenureView districts={districts} />
        ) : (
          <>
            {nav.level === "company" && (
              <>
                <MonthlyReviewCard onGo={(v) => setView(v)} />
                <Company districts={districts} roll={roll} meta={districtMeta} canWrite={rollupQ.data?.can_write ?? false} onOpen={(id) => setNav({ level: "district", districtId: id })} />
              </>
            )}
            {nav.level === "district" && district && (
              <District district={district} onOpen={(sid) => setNav({ level: "store", districtId: district.id, storeId: sid })} />
            )}
            {nav.level === "store" && store && <Store store={store} />}
          </>
        )}
      </div>
    </MemberDrawerProvider>
  );
}

// ── shared ──────────────────────────────────────────────────────────────────
function sumRisk(stores: MyStoreNode[], roll: RollupResponse["stores"]) {
  let immediate = 0, medium = 0, reqs = 0, roster = 0, gmRisk = 0, short = 0;
  const risk: RiskCounts = { immediate: 0, medium: 0, low: 0, na: 0 };
  for (const s of stores) {
    const r = roll[s.id] ?? ZERO;
    immediate += r.risk.immediate; medium += r.risk.medium; reqs += r.open_reqs; roster += r.roster;
    risk.immediate += r.risk.immediate; risk.medium += r.risk.medium; risk.low += r.risk.low; risk.na += r.risk.na;
    if (r.gm_risk === "immediate" || r.gm_risk === "medium") gmRisk += 1;
    if (r.target != null) short += Math.max(0, r.target - r.non_gm); // team members below sales target (excl GM)
  }
  return { immediate, medium, reqs, roster, gmRisk, short, risk };
}

// Risk-distribution donut (immediate=red, medium=amber, low=green, na=grey).
function RiskDonut({ risk, size = 56, stroke = 7 }: { risk: RiskCounts; size?: number; stroke?: number }) {
  const total = risk.immediate + risk.medium + risk.low + risk.na;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const segs = [
    { v: risk.immediate, color: "#ef4444" },
    { v: risk.medium, color: "#f59e0b" },
    { v: risk.low, color: "#10b981" },
    { v: risk.na, color: "#e4e4e7" },
  ];
  // pathLength=100 makes the dash math exact (percentages, no circumference
  // rounding); the <g> rotates around the true center so arcs start at 12
  // o'clock and sit on the ring.
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <g transform={`rotate(-90 ${c} ${c})`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="#f1f1f4" strokeWidth={stroke} />
        {total > 0 && segs.map((s, i) => {
          if (s.v <= 0) return null;
          const pct = (s.v / total) * 100;
          const el = (
            <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              pathLength={100} strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-acc} />
          );
          acc += pct;
          return el;
        })}
      </g>
    </svg>
  );
}

function Breadcrumb({ nav, district, store, onGo }: { nav: Nav; district: MyDistrictNode | null; store: MyStoreNode | null; onGo: (n: Nav) => void }) {
  const crumb = "text-sm font-semibold text-accent hover:underline";
  return (
    <div className="mb-4 flex items-center gap-2 text-sm">
      {nav.level === "company"
        ? <span className="font-semibold text-heading">All districts</span>
        : <button className={crumb} onClick={() => onGo({ level: "company" })}>All districts</button>}
      {district && (
        <>
          <ChevronRight className="h-4 w-4 text-ink-subtle" />
          {nav.level === "district"
            ? <span className="font-semibold text-heading">{district.name || "District"}</span>
            : <button className={crumb} onClick={() => onGo({ level: "district", districtId: district.id })}>{district.name || "District"}</button>}
        </>
      )}
      {store && (
        <>
          <ChevronRight className="h-4 w-4 text-ink-subtle" />
          <span className="font-semibold text-heading">{store.name || `Store #${store.number}`}</span>
        </>
      )}
    </div>
  );
}

// ── Company ─────────────────────────────────────────────────────────────────
type DistrictMeta = Map<string, { regionName: string | null; doName: string | null }>;

// ── Succession & Risk — leadership view (DO→COO) ──────────────────────────────
// Named at-risk people in the caller's scope, and GM-seat backfill exposure
// (at-risk/open seats with no identified successor) + the plan to close each
// gap. Grouped by district so a leader sees the breakdown across their span.
function SuccessionView({ districts, districtMeta }: { districts: MyDistrictNode[]; districtMeta: DistrictMeta }) {
  const { open } = useMemberDrawer();
  const q = useQuery({ queryKey: ["tp-succession"], queryFn: fetchSuccession, staleTime: 60_000 });
  const reviewQ = useQuery({ queryKey: ["tp-risk-review"], queryFn: fetchRiskReview, staleTime: 60_000 });
  const [tab, setTab] = useState<"exposure" | "atrisk" | "signals">("exposure");
  const districtName = (id: string | null) => (id ? districts.find((d) => d.id === id)?.name ?? "—" : "Unassigned");
  const doName = (id: string | null) => (id ? districtMeta.get(id)?.doName ?? null : null);
  const openReviewRow = (m: RiskReviewRow) => open({
    id: m.member_id, store_id: m.store_id, full_name: m.name, role: m.role, flight_risk: m.flight_risk,
    risk_reasons: [], aspiration: m.aspiration, perf: m.perf, potential: m.potential, backfill: null,
    status: "active", profile_id: null, external_id: null, email: null, phone: null, hire_date: m.hire_date,
    comment: null, comment_by: null, created_at: "", updated_at: "",
  } as TeamMember);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load succession" description={(q.error as Error)?.message ?? "Try again."} />;
  const data = q.data as SuccessionResponse;
  const s = data.summary;

  return (
    <div className="space-y-5">
      {/* Headline exposure numbers — coverage keyed off ready-now successors */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SuccTile label="GM seats exposed" value={s.gm_exposed} sub={`of ${s.gm_at_risk + s.gm_open} at-risk/open · no successor`} tone={s.gm_exposed > 0 ? "red" : "ok"} big />
        <SuccTile label="Ready-now successor" value={s.gm_ready ?? 0} sub="at an at-risk/open seat" tone={(s.gm_ready ?? 0) > 0 ? "ok" : "amber"} />
        <SuccTile label="Developing" value={s.gm_developing ?? 0} sub="on the bench, not ready" tone={(s.gm_developing ?? 0) > 0 ? "amber" : "ok"} />
        <SuccTile label="People at risk" value={s.at_risk_total} sub={`${s.at_risk_immediate} immediate · ${s.at_risk_medium} medium`} tone={s.at_risk_immediate > 0 ? "red" : s.at_risk_medium > 0 ? "amber" : "ok"} />
      </div>

      <Segmented<"exposure" | "atrisk" | "signals">
        value={tab}
        onChange={setTab}
        options={[
          { value: "exposure", label: "Backfill exposure", count: s.gm_exposed },
          { value: "atrisk", label: "At-risk people", count: s.at_risk_total },
          { value: "signals", label: "Risk signals", count: reviewQ.data?.summary.gaps ?? 0 },
        ]}
      />

      {tab === "exposure" ? (
        <ExposureTable seats={data.gm_seats} districtName={districtName} doName={doName} onOpenStore={undefined} />
      ) : tab === "atrisk" ? (
        <AtRiskTable people={data.at_risk} districtName={districtName} onOpen={(m) => {
          // Open the member card. The drawer takes a TeamMember; we synthesize
          // the minimum it needs from the at-risk row.
          open({ id: m.member_id, store_id: m.store_id, full_name: m.name, role: m.role, flight_risk: m.risk,
            risk_reasons: m.reasons, aspiration: m.aspiration, perf: m.perf, potential: m.potential,
            backfill: m.backfill, status: "active", profile_id: null, external_id: null, email: null,
            phone: null, hire_date: null, comment: null, comment_by: null, created_at: "", updated_at: "" } as TeamMember);
        }} />
      ) : reviewQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <RiskReviewTable rows={reviewQ.data?.rows ?? []} districtName={districtName} onOpen={openReviewRow} />
      )}
    </div>
  );
}

function SuccTile({ label, value, sub, tone, big }: { label: string; value: number; sub?: string; tone: "red" | "amber" | "ok"; big?: boolean }) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-emerald-600";
  return (
    <div className={cn("rounded-xl border bg-surface p-4", big ? "border-border ring-1 ring-inset ring-border" : "border-border")}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className={cn("mt-1 font-bold tabular-nums", big ? "text-4xl" : "text-3xl", color)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-muted">{sub}</div>}
    </div>
  );
}

const PLAN_META: Record<string, { label: string; chip: string }> = {
  ready: { label: "Ready now", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  develop: { label: "Develop successor", chip: "bg-blue-50 text-blue-700 ring-blue-200" },
  req: { label: "Req open", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  none: { label: "No plan", chip: "bg-red-50 text-red-700 ring-red-200" },
};
const SEAT_META: Record<GmSeat["seat_status"], { label: string; chip: string }> = {
  at_risk: { label: "GM at risk", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  open: { label: "Seat open", chip: "bg-red-50 text-red-700 ring-red-200" },
  ok: { label: "Covered", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};
// Exposed seats first, then developing, then ready — worst gap up top.
const COVERAGE_ORDER: Record<GmSeat["coverage"], number> = { exposed: 0, developing: 1, ready: 2, ok: 3 };

function ExposureTable({ seats, districtName, doName }: {
  seats: GmSeat[];
  districtName: (id: string | null) => string;
  doName: (id: string | null) => string | null;
  onOpenStore?: (id: string) => void;
}) {
  // Only the seats that need attention: at-risk or open. Worst coverage first.
  const rows = seats
    .filter((s) => s.seat_status !== "ok")
    .sort((a, b) =>
      ((COVERAGE_ORDER[a.coverage] ?? 9) - (COVERAGE_ORDER[b.coverage] ?? 9)) ||
      String(a.store_number).localeCompare(String(b.store_number), undefined, { numeric: true }));
  if (rows.length === 0) {
    return <EmptyState title="No GM-seat exposure" description="Every at-risk or open GM seat in your scope has a ready successor on the bench." />;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
              <th className="px-4 py-2">Store</th><th className="px-4 py-2">District / DO</th>
              <th className="px-4 py-2">GM</th><th className="px-4 py-2">Seat</th>
              <th className="px-4 py-2">Successor bench</th><th className="px-4 py-2">Plan to close</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((s) => {
              const seat = SEAT_META[s.seat_status];
              const plan = s.plan ? PLAN_META[s.plan.type] : null;
              const bench = s.bench ?? [];
              const top = bench[0] ?? null;
              return (
                <tr key={s.store_id} className={cn(s.coverage === "exposed" && "bg-red-50/30")}>
                  <td className="px-4 py-2.5"><span className="font-semibold text-heading">#{s.store_number}</span><span className="ml-2 text-ink-muted">{s.store_name}</span></td>
                  <td className="px-4 py-2.5 text-ink-2">{districtName(s.district_id)}{doName(s.district_id) ? <span className="text-ink-muted"> · {doName(s.district_id)}</span> : null}</td>
                  <td className="px-4 py-2.5 text-ink-2">{s.gm_name ?? <span className="text-ink-muted">—</span>}</td>
                  <td className="px-4 py-2.5"><SChip {...seat} /></td>
                  <td className="px-4 py-2.5">
                    {top ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-ink-2">{top.name}</span>
                        <SChip label={READINESS_META[top.readiness].short} chip={READINESS_META[top.readiness].chip} />
                        {bench.length > 1 && <span className="text-[11px] text-ink-subtle">+{bench.length - 1}</span>}
                      </span>
                    ) : s.backfill ? (
                      <span className="text-ink-2">{s.backfill} <span className="text-[11px] text-ink-subtle">(no readiness)</span></span>
                    ) : (
                      <span className="text-ink-muted">— none</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {plan && <SChip {...plan} />}
                    {s.plan?.detail && <span className="ml-2 text-xs text-ink-muted">{s.plan.type === "req" ? `Req ${s.plan.detail}` : s.plan.detail}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AtRiskTable({ people, districtName, onOpen }: {
  people: AtRiskMember[];
  districtName: (id: string | null) => string;
  onOpen: (m: AtRiskMember) => void;
}) {
  if (people.length === 0) return <EmptyState title="No one flagged at risk" description="No medium or immediate risk in your scope." />;
  const tenure = (d: number | null) => (d == null ? "—" : d < 90 ? `${d}d` : d < 730 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
              <th className="px-4 py-2">Name</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Store / District</th>
              <th className="px-4 py-2">Risk</th><th className="px-4 py-2">Reasons</th>
              <th className="px-4 py-2">Tenure</th><th className="px-4 py-2">CAP</th><th className="px-4 py-2">Backfill</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {people.map((m) => (
              <tr key={m.member_id} className={cn("cursor-pointer hover:bg-surface-muted", m.risk === "immediate" && "bg-red-50/30")} onClick={() => onOpen(m)}>
                <td className="px-4 py-2.5 font-semibold text-heading">{m.name}</td>
                <td className="px-4 py-2.5 text-ink-2">{LADDER_BY_KEY[m.role]?.label ?? m.role}</td>
                <td className="px-4 py-2.5 text-ink-2">#{m.store_number} <span className="text-ink-muted">· {districtName(m.district_id)}</span></td>
                <td className="px-4 py-2.5"><SChip label={RISK_META[m.risk].short} chip={RISK_META[m.risk].chip} /></td>
                <td className="px-4 py-2.5 text-xs text-ink-muted">{m.reasons.length ? m.reasons.join(", ") : "—"}</td>
                <td className="px-4 py-2.5 tabular-nums text-ink-2">{tenure(m.tenure_days)}</td>
                <td className="px-4 py-2.5">{m.cap_level ? <SChip label={m.cap_level.toUpperCase()} chip="bg-red-50 text-red-700 ring-red-200" /> : <span className="text-ink-muted">—</span>}</td>
                <td className="px-4 py-2.5 text-ink-2">{m.role === "gm" ? (m.backfill ?? <span className="text-red-500">none</span>) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SChip({ label, chip }: { label: string; chip: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", chip)}>{label}</span>;
}

// Signal-assisted risk review — people the data flags, gaps (data > manual
// flag) first. A "who should I look at?" queue; click a row to open the card.
function RiskReviewTable({ rows, districtName, onOpen }: {
  rows: RiskReviewRow[];
  districtName: (id: string | null) => string;
  onOpen: (m: RiskReviewRow) => void;
}) {
  if (rows.length === 0) return <EmptyState title="No risk signals" description="Nobody in your scope is showing data-driven risk cues right now." />;
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Cues from the data — discipline, stated aspiration, tenure, ratings, and development-plan coverage. A{" "}
        <span className="font-semibold text-red-600">gap</span> means the data flags higher than the current manual risk. Click a row to review.
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-2">Name</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Store / District</th>
                <th className="px-4 py-2">Top signal</th><th className="px-4 py-2">Manual</th><th className="px-4 py-2">Suggested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((m) => {
                const sev = SIGNAL_SEVERITY_META[m.top_signal.severity];
                return (
                  <tr key={m.member_id} className={cn("cursor-pointer hover:bg-surface-muted", m.gap && "bg-red-50/30")} onClick={() => onOpen(m)}>
                    <td className="px-4 py-2.5 font-semibold text-heading">
                      {m.name}
                      {m.gap && <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">GAP</span>}
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{LADDER_BY_KEY[m.role]?.label ?? m.role}</td>
                    <td className="px-4 py-2.5 text-ink-2">#{m.store_number} <span className="text-ink-muted">· {districtName(m.district_id)}</span></td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sev.dot)} />
                        <span className="text-ink-2">{m.top_signal.label}</span>
                        {m.signal_count > 1 && <span className="text-[11px] text-ink-subtle">+{m.signal_count - 1}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5"><SChip label={RISK_META[m.flight_risk].short} chip={RISK_META[m.flight_risk].chip} /></td>
                    <td className="px-4 py-2.5">
                      {m.gap
                        ? <SChip label={RISK_META[m.suggested].short} chip={RISK_META[m.suggested].chip} />
                        : <span className="text-ink-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Development (PDP roll-up) ─────────────────────────────────────────────────
// Leadership view of development-plan coverage: how much of the span has a real
// plan, who most needs one, and which goals are overdue or coming due.
function DevelopmentView({ districts, districtMeta }: { districts: MyDistrictNode[]; districtMeta: DistrictMeta }) {
  const { open } = useMemberDrawer();
  const q = useQuery({ queryKey: ["tp-dev-rollup"], queryFn: fetchDevRollup, staleTime: 60_000 });
  const readyQ = useQuery({ queryKey: ["tp-readiness-rollup"], queryFn: fetchReadinessRollup, staleTime: 60_000 });
  const [tab, setTab] = useState<"coverage" | "gaps" | "stalled" | "due" | "readiness">("coverage");
  const districtName = (id: string | null) => (id ? districts.find((d) => d.id === id)?.name ?? "—" : "Unassigned");
  const doName = (id: string | null) => (id ? districtMeta.get(id)?.doName ?? null : null);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load development" description={(q.error as Error)?.message ?? "Try again."} />;
  const data = q.data as DevRollupResponse;
  const s = data.summary;

  const openRow = (r: { member_id: string | null; store_id: string; name: string; role: LadderKey | null; perf?: number | null; potential?: number | null; aspiration?: Aspiration; hire_date?: string | null }) => {
    if (!r.member_id) return;
    open({ id: r.member_id, store_id: r.store_id, full_name: r.name, role: r.role ?? "crew", flight_risk: "na",
      risk_reasons: [], aspiration: r.aspiration ?? "current", perf: r.perf ?? null, potential: r.potential ?? null,
      backfill: null, status: "active", profile_id: null, external_id: null, email: null, phone: null,
      hire_date: r.hire_date ?? null, comment: null, comment_by: null, created_at: "", updated_at: "" } as TeamMember);
  };

  const covTone = s.coverage_pct >= 70 ? "text-emerald-600" : s.coverage_pct >= 40 ? "text-amber-600" : "text-red-600";

  return (
    <div className="space-y-5">
      <TalentExportBar districts={districts} districtMeta={districtMeta} />

      {/* Headline coverage numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4 ring-1 ring-inset ring-border">
          <div className="text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Plan coverage</div>
          <div className={cn("mt-1 text-4xl font-bold tabular-nums", covTone)}>{s.coverage_pct}%</div>
          <div className="mt-0.5 text-[11px] text-ink-muted">{s.with_plan} of {s.roster_total} have a plan</div>
        </div>
        <SuccTile label="Needs a plan" value={s.key_gap_total} sub="high-potential / aspirant / mgr" tone={s.key_gap_total > 0 ? "amber" : "ok"} />
        <SuccTile label="Stalled goals" value={s.stalled_total} sub="past target, not done" tone={s.stalled_total > 0 ? "red" : "ok"} />
        <SuccTile label="Due soon" value={s.due_soon_total} sub="within 30 days" tone={s.due_soon_total > 0 ? "amber" : "ok"} />
      </div>

      {/* Goal progress bar */}
      {s.goals_total > 0 && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-ink-muted">
            <span>Development goals</span>
            <span>{s.goals_done} done · {s.goals_in_progress} in progress · {s.goals_open} not started</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-surface-sunk">
            <div className="bg-emerald-500" style={{ width: `${(s.goals_done / s.goals_total) * 100}%` }} />
            <div className="bg-blue-500" style={{ width: `${(s.goals_in_progress / s.goals_total) * 100}%` }} />
          </div>
        </div>
      )}

      <Segmented<"coverage" | "gaps" | "stalled" | "due" | "readiness">
        value={tab}
        onChange={setTab}
        options={[
          { value: "coverage", label: "Coverage by district" },
          { value: "gaps", label: "Needs a plan", count: s.key_gap_total },
          { value: "stalled", label: "Stalled", count: s.stalled_total },
          { value: "due", label: "Due soon", count: s.due_soon_total },
          { value: "readiness", label: "Readiness", count: readyQ.data?.summary.ready_now ?? 0 },
        ]}
      />

      {tab === "coverage" ? (
        <DevCoverageTable rows={data.districts} districtName={districtName} doName={doName} />
      ) : tab === "gaps" ? (
        <DevGapTable rows={data.gaps} districtName={districtName} onOpen={openRow} />
      ) : tab === "readiness" ? (
        readyQ.isLoading ? <Skeleton className="h-64 w-full" /> : <ReadinessTable rows={readyQ.data?.rows ?? []} summary={readyQ.data?.summary} districtName={districtName} onOpen={openRow} />
      ) : (
        <DevGoalTable rows={tab === "stalled" ? data.stalled : data.due_soon} overdue={tab === "stalled"} districtName={districtName} onOpen={openRow} />
      )}
    </div>
  );
}

// Assessment readiness from acknowledged NLAs: who the tool says is ready to
// promote, ready-now first, with a reassessment-due flag for stale snapshots.
function ReadinessTable({ rows, summary, districtName, onOpen }: {
  rows: ReadinessRow[];
  summary?: { total: number; ready_now: number; ready_soon: number; developing: number; reassess_due: number };
  districtName: (id: string | null) => string;
  onOpen: (m: { member_id: string | null; store_id: string; name: string; role: LadderKey | null }) => void;
}) {
  if (rows.length === 0) return <EmptyState title="No assessment readiness yet" description="When a Next Level Assessment is acknowledged, the person's readiness shows here." />;
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—");
  return (
    <div className="space-y-2">
      {summary && (
        <p className="text-xs text-ink-muted">
          <span className="font-semibold text-emerald-600">{summary.ready_now}</span> ready now ·{" "}
          <span className="font-semibold text-amber-600">{summary.ready_soon}</span> ready soon ·{" "}
          {summary.developing} developing{summary.reassess_due > 0 ? <> · <span className="font-semibold text-amber-700">{summary.reassess_due}</span> due for reassessment</> : null}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-2">Name</th><th className="px-4 py-2">Store / District</th>
                <th className="px-4 py-2">For</th><th className="px-4 py-2">Readiness</th><th className="px-4 py-2">Assessed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((m) => {
                const bm = READINESS_BAND_META[m.readiness_band];
                return (
                  <tr key={m.member_id} className="cursor-pointer hover:bg-surface-muted" onClick={() => onOpen({ member_id: m.member_id, store_id: m.store_id ?? "", name: m.name, role: m.role })}>
                    <td className="px-4 py-2.5 font-semibold text-heading">{m.name}</td>
                    <td className="px-4 py-2.5 text-ink-2">#{m.store_number} <span className="text-ink-muted">· {districtName(m.district_id)}</span></td>
                    <td className="px-4 py-2.5 text-ink-2">{m.target_role.toUpperCase()}</td>
                    <td className="px-4 py-2.5"><SChip label={bm.label} chip={bm.chip} /></td>
                    <td className="px-4 py-2.5 text-ink-2">
                      {fmt(m.snapshot_date)}
                      {m.reassess_due && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">due</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DevCoverageTable({ rows, districtName, doName }: {
  rows: DevRollupResponse["districts"];
  districtName: (id: string | null) => string;
  doName: (id: string | null) => string | null;
}) {
  if (rows.length === 0) return <EmptyState title="No roster yet" description="No team members in your scope to plan for." />;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
              <th className="px-4 py-2">District / DO</th><th className="px-4 py-2">Roster</th>
              <th className="px-4 py-2">With plan</th><th className="px-4 py-2">Coverage</th>
              <th className="px-4 py-2">Needs a plan</th><th className="px-4 py-2">Stalled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((d) => {
              const tone = d.coverage_pct >= 70 ? "text-emerald-600" : d.coverage_pct >= 40 ? "text-amber-600" : "text-red-600";
              return (
                <tr key={d.district_id ?? "none"}>
                  <td className="px-4 py-2.5 text-ink-2">{districtName(d.district_id)}{doName(d.district_id) ? <span className="text-ink-muted"> · {doName(d.district_id)}</span> : null}</td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-2">{d.roster}</td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-2">{d.with_plan}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunk"><div className="h-full bg-accent" style={{ width: `${d.coverage_pct}%` }} /></div>
                      <span className={cn("text-xs font-bold tabular-nums", tone)}>{d.coverage_pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{d.key_gap > 0 ? <span className="font-semibold text-amber-700">{d.key_gap}</span> : <span className="text-ink-muted">0</span>}</td>
                  <td className="px-4 py-2.5 tabular-nums">{d.stalled > 0 ? <span className="font-semibold text-red-600">{d.stalled}</span> : <span className="text-ink-muted">0</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DevGapTable({ rows, districtName, onOpen }: {
  rows: DevGapRow[];
  districtName: (id: string | null) => string;
  onOpen: (m: DevGapRow) => void;
}) {
  if (rows.length === 0) return <EmptyState title="No coverage gaps" description="Everyone who should have a development plan has one." />;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
              <th className="px-4 py-2">Name</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Store / District</th>
              <th className="px-4 py-2">Why they need one</th><th className="px-4 py-2">Aspiration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((m) => (
              <tr key={m.member_id} className="cursor-pointer hover:bg-surface-muted" onClick={() => onOpen(m)}>
                <td className="px-4 py-2.5 font-semibold text-heading">{m.name}</td>
                <td className="px-4 py-2.5 text-ink-2">{LADDER_BY_KEY[m.role]?.label ?? m.role}</td>
                <td className="px-4 py-2.5 text-ink-2">#{m.store_number} <span className="text-ink-muted">· {districtName(m.district_id)}</span></td>
                <td className="px-4 py-2.5"><SChip label={m.reason} chip="bg-amber-50 text-amber-800 ring-amber-200" /></td>
                <td className="px-4 py-2.5"><SChip label={ASPIRATION_META[m.aspiration].label} chip={ASPIRATION_META[m.aspiration].chip} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DevGoalTable({ rows, overdue, districtName, onOpen }: {
  rows: DevGoalRow[];
  overdue: boolean;
  districtName: (id: string | null) => string;
  onOpen: (m: DevGoalRow) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState title={overdue ? "No stalled goals" : "Nothing due soon"} description={overdue ? "No development goals are past their target date." : "No goals come due in the next 30 days."} />;
  }
  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
              <th className="px-4 py-2">Name</th><th className="px-4 py-2">Goal</th><th className="px-4 py-2">Store / District</th>
              <th className="px-4 py-2">Target</th><th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((m) => (
              <tr key={m.item_id} className={cn("cursor-pointer hover:bg-surface-muted", overdue && "bg-red-50/30")} onClick={() => onOpen(m)}>
                <td className="px-4 py-2.5 font-semibold text-heading">{m.name}</td>
                <td className="px-4 py-2.5 text-ink-2">{m.focus_area}</td>
                <td className="px-4 py-2.5 text-ink-2">#{m.store_number} <span className="text-ink-muted">· {districtName(m.district_id)}</span></td>
                <td className={cn("px-4 py-2.5 tabular-nums", overdue ? "font-semibold text-red-600" : "text-ink-2")}>{fmt(m.target_date)}</td>
                <td className="px-4 py-2.5"><SChip label={m.status === "in_progress" ? "In progress" : "Not started"} chip={m.status === "in_progress" ? "bg-blue-50 text-blue-700 ring-blue-200" : "bg-zinc-100 text-zinc-600 ring-zinc-200"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Monthly talent-review nudge ───────────────────────────────────────────────
// One-glance "what needs working this month" on the landing, with a stamp so
// the monthly motion is tracked. Chips jump to the relevant view.
function MonthlyReviewCard({ onGo }: { onGo: (v: ReviewView) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["tp-monthly-review"], queryFn: fetchMonthlyReview, staleTime: 60_000 });
  const mark = useMutation({
    mutationFn: () => markReviewed(),
    onSuccess: () => { toast.push("Marked reviewed for this month.", "success"); qc.invalidateQueries({ queryKey: ["tp-monthly-review"] }); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't save.", "error"),
  });
  if (q.isLoading || q.isError || !q.data) return null;
  const data = q.data;
  const monthName = new Date(data.period + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const reviewed = !!data.reviewed_at;
  const allClear = data.open_total === 0;

  return (
    <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent"><CalendarCheck2 className="h-5 w-5" /></span>
        <div className="mr-auto min-w-0">
          <div className="text-sm font-bold text-heading">Monthly talent review · {monthName}</div>
          <div className="text-[12px] text-ink-muted">
            {reviewed
              ? `Reviewed ${new Date(data.reviewed_at as string).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
              : allClear ? "Queues are clear — nothing open in your span." : `${data.open_total} open across your span`}
          </div>
        </div>
        {reviewed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"><Check className="h-3.5 w-3.5" />Reviewed</span>
        ) : (
          <button onClick={() => mark.mutate()} disabled={mark.isPending}
            className="rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
            {mark.isPending ? "Saving…" : "Mark reviewed"}
          </button>
        )}
      </div>
      {!allClear && (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.items.filter((i) => i.count > 0).map((i) => (
            <button key={i.key} onClick={() => onGo(i.view)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-surface-sunk">
              <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-red-100 px-1 text-[11px] font-bold text-red-700">{i.count}</span>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Talent review packet (per-district CSV + print) ───────────────────────────
const NINE_BOX_TITLE = (perf: number | null, potential: number | null): string =>
  perf == null || potential == null ? "" : NINE_BOX[potRow(potential)][perfCol(perf)].title;
const monthsLabel = (days: number | null): string =>
  days == null ? "—" : days < 30 ? `${days}d` : days < 365 ? `${Math.round(days / 30.44)}mo` : `${(days / 365).toFixed(1)}y`;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

function talentCsv(data: TalentExportResponse): string {
  const headers = [
    "Store", "Store name", "Name", "Role", "Tenure", "Time in role", "Perf", "Potential", "9-box",
    "Risk", "Risk reasons", "Aspiration", "Successor", "Successor readiness", "Open CAs", "Has plan", "Last note",
  ];
  const rows = data.member_rows.map((m) => ({
    "Store": m.store_number, "Store name": m.store_name, "Name": m.name, "Role": LADDER_BY_KEY[m.role]?.label ?? m.role,
    "Tenure": monthsLabel(m.tenure_days), "Time in role": monthsLabel(m.role_days),
    "Perf": m.perf ?? "", "Potential": m.potential ?? "", "9-box": NINE_BOX_TITLE(m.perf, m.potential),
    "Risk": RISK_META[m.flight_risk].short, "Risk reasons": m.risk_reasons.join("; "),
    "Aspiration": ASPIRATION_META[m.aspiration].label,
    "Successor": m.successor ?? "", "Successor readiness": m.successor_readiness ? READINESS_META[m.successor_readiness].short : "",
    "Open CAs": m.open_cas, "Has plan": m.has_plan ? "Yes" : "No", "Last note": m.last_note ?? "",
  }));
  return toCSV(headers, rows);
}

function openTalentPacket(data: TalentExportResponse, doName: string | null, today: string) {
  const dn = data.district.name || "District";
  const rows = data.member_rows.map((m) => `
    <tr class="${m.flight_risk === "immediate" ? "hot" : m.flight_risk === "medium" ? "warm" : ""}">
      <td>#${esc(m.store_number)}</td><td>${esc(m.name)}</td><td>${esc(LADDER_BY_KEY[m.role]?.abbr ?? m.role)}</td>
      <td>${esc(monthsLabel(m.tenure_days))}</td><td>${esc(monthsLabel(m.role_days))}</td>
      <td class="c">${m.perf ?? "—"}</td><td class="c">${m.potential ?? "—"}</td><td>${esc(NINE_BOX_TITLE(m.perf, m.potential))}</td>
      <td>${esc(RISK_META[m.flight_risk].short)}</td><td>${esc(ASPIRATION_META[m.aspiration].label)}</td>
      <td>${esc(m.successor ?? "—")}${m.successor_readiness ? ` <span class="tag">${esc(READINESS_META[m.successor_readiness].short)}</span>` : ""}</td>
      <td class="c">${m.has_plan ? "✓" : "—"}</td>
    </tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Talent review — ${esc(dn)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font: 12px/1.4 -apple-system, Segoe UI, Roboto, sans-serif; color: #18181b; margin: 32px; }
      h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #71717a; font-size: 12px; margin-bottom: 16px; }
      table { border-collapse: collapse; width: 100%; font-size: 11px; }
      th, td { border: 1px solid #e4e4e7; padding: 5px 7px; text-align: left; vertical-align: top; }
      th { background: #f4f4f5; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #52525b; }
      td.c { text-align: center; } tr.hot { background: #fef2f2; } tr.warm { background: #fffbeb; }
      .tag { display: inline-block; background: #f4f4f5; border-radius: 8px; padding: 0 5px; font-size: 9px; color: #52525b; }
      .foot { margin-top: 14px; color: #a1a1aa; font-size: 10px; }
      @media print { body { margin: 12mm; } button { display: none; } }
      button { margin-bottom: 16px; padding: 8px 14px; font-size: 13px; font-weight: 600; border: 0; border-radius: 8px; background: #111827; color: #fff; cursor: pointer; }
    </style></head><body>
    <button onclick="window.print()">Print / Save as PDF</button>
    <h1>Talent Review — ${esc(dn)}</h1>
    <div class="sub">${doName ? `DO ${esc(doName)} · ` : ""}${data.store_count} store${data.store_count === 1 ? "" : "s"} · ${data.member_rows.length} team members · prepared ${esc(today)}${data.generated_by ? ` by ${esc(data.generated_by)}` : ""}</div>
    <table><thead><tr>
      <th>Store</th><th>Name</th><th>Role</th><th>Tenure</th><th>In role</th><th>Perf</th><th>Pot</th><th>9-box</th><th>Risk</th><th>Aspiration</th><th>Successor</th><th>Plan</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="foot">SOAR Hub · Talent Review packet. Confidential — for calibration use only.</div>
    </body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); }
}

function TalentExportBar({ districts, districtMeta }: { districts: MyDistrictNode[]; districtMeta: DistrictMeta }) {
  const toast = useToast();
  const [districtId, setDistrictId] = useState<string>(districts[0]?.id ?? "");
  const [busy, setBusy] = useState<"csv" | "packet" | null>(null);
  const doName = (id: string) => districtMeta.get(id)?.doName ?? null;

  const run = async (mode: "csv" | "packet") => {
    if (!districtId) return;
    setBusy(mode);
    try {
      const data = await fetchTalentExport(districtId);
      if (!data.member_rows.length) { toast.push("No team members in that district yet.", "info"); return; }
      const dn = data.district.name || "district";
      if (mode === "csv") {
        downloadCSV(`talent-review-${dn.replace(/\s+/g, "-").toLowerCase()}.csv`, talentCsv(data));
      } else {
        const today = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
        openTalentPacket(data, doName(districtId), today);
      }
    } catch (e) {
      toast.push((e as Error)?.message ?? "Couldn't build the packet.", "error");
    } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-muted px-3 py-2.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Talent review packet</span>
      <select value={districtId} onChange={(e) => setDistrictId(e.target.value)}
        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-heading focus:border-accent focus:outline-none">
        {districts.length === 0 && <option value="">No districts</option>}
        {districts.map((d) => <option key={d.id} value={d.id}>{d.name || "District"}</option>)}
      </select>
      <div className="ml-auto flex items-center gap-1.5">
        <button disabled={!districtId || busy !== null} onClick={() => run("packet")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
          {busy === "packet" ? "Building…" : "Open print packet"}
        </button>
        <button disabled={!districtId || busy !== null} onClick={() => run("csv")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-surface-sunk disabled:opacity-40">
          {busy === "csv" ? "Building…" : "Download CSV"}
        </button>
      </div>
    </div>
  );
}

// ── Time in role ──────────────────────────────────────────────────────────────
// How long people have held their current role: distribution, per-level medians,
// who's "ready for a move", and the longest-tenured seats.
function TenureView({ districts }: { districts: MyDistrictNode[] }) {
  const { open } = useMemberDrawer();
  const q = useQuery({ queryKey: ["tp-tenure-rollup"], queryFn: fetchTenureRollup, staleTime: 60_000 });
  const [tab, setTab] = useState<"ready" | "longest">("ready");
  const districtName = (id: string | null) => (id ? districts.find((d) => d.id === id)?.name ?? "—" : "Unassigned");

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load time in role" description={(q.error as Error)?.message ?? "Try again."} />;
  const data = q.data as TenureRollupResponse;
  const s = data.summary;
  const maxBand = Math.max(1, ...data.bands.map((b) => b.count));

  const openRow = (m: TenureMember) => open({
    id: m.member_id, store_id: m.store_id, full_name: m.name, role: m.role, flight_risk: m.flight_risk,
    risk_reasons: [], aspiration: m.aspiration, perf: m.perf, potential: m.potential, backfill: null,
    status: "active", profile_id: null, external_id: null, email: null, phone: null, hire_date: m.hire_date,
    comment: null, comment_by: null, created_at: "", updated_at: "",
  } as TeamMember);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SuccTile label="Median time in role" value={s.median_months} sub="months, across your span" tone="ok" big />
        <SuccTile label="Ready for a move" value={s.ready_total} sub="2yr+ in role, aspiring up" tone={s.ready_total > 0 ? "amber" : "ok"} />
        <SuccTile label="New in seat" value={s.new_in_seat} sub="mgr <90 days in role" tone={s.new_in_seat > 0 ? "amber" : "ok"} />
        <SuccTile label="Undated" value={s.unknown} sub="no hire / role date" tone="ok" />
      </div>

      {/* Distribution */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Time in current role</div>
        <div className="space-y-2">
          {data.bands.map((b) => (
            <div key={b.key} className="flex items-center gap-3">
              <div className="w-16 shrink-0 text-right text-xs font-semibold text-ink-2">{b.label}</div>
              <div className="h-5 flex-1 overflow-hidden rounded bg-surface-sunk">
                <div className="h-full rounded bg-accent" style={{ width: `${(b.count / maxBand) * 100}%` }} />
              </div>
              <div className="w-8 shrink-0 text-xs font-bold tabular-nums text-heading">{b.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Median by level */}
      {data.by_level.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Median time in role, by level</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {data.by_level.map((l) => (
                  <tr key={l.role}>
                    <td className="px-4 py-2 font-semibold text-heading">{LADDER_BY_KEY[l.role]?.label ?? l.role}</td>
                    <td className="px-4 py-2 tabular-nums text-ink-muted">{l.count} {l.count === 1 ? "person" : "people"}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-ink-2">{l.median_months} mo median</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Segmented<"ready" | "longest">
        value={tab}
        onChange={setTab}
        options={[
          { value: "ready", label: "Ready for a move", count: data.ready.length },
          { value: "longest", label: "Longest in role", count: data.longest.length },
        ]}
      />
      <TenureTable rows={tab === "ready" ? data.ready : data.longest} districtName={districtName} onOpen={openRow}
        emptyTitle={tab === "ready" ? "No one flagged ready" : "No seats yet"}
        emptyDesc={tab === "ready" ? "Nobody in your span is 2yr+ in role and aspiring up." : "No team members with a role date."} />
    </div>
  );
}

function TenureTable({ rows, districtName, onOpen, emptyTitle, emptyDesc }: {
  rows: TenureMember[];
  districtName: (id: string | null) => string;
  onOpen: (m: TenureMember) => void;
  emptyTitle: string; emptyDesc: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDesc} />;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
              <th className="px-4 py-2">Name</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Store / District</th>
              <th className="px-4 py-2">Time in role</th><th className="px-4 py-2">Aspiration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((m) => (
              <tr key={m.member_id} className="cursor-pointer hover:bg-surface-muted" onClick={() => onOpen(m)}>
                <td className="px-4 py-2.5 font-semibold text-heading">{m.name}</td>
                <td className="px-4 py-2.5 text-ink-2">{LADDER_BY_KEY[m.role]?.label ?? m.role}</td>
                <td className="px-4 py-2.5 text-ink-2">#{m.store_number} <span className="text-ink-muted">· {districtName(m.district_id)}</span></td>
                <td className="px-4 py-2.5 tabular-nums font-semibold text-ink-2">{m.role_months} mo</td>
                <td className="px-4 py-2.5"><SChip label={ASPIRATION_META[m.aspiration].label} chip={ASPIRATION_META[m.aspiration].chip} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Company({ districts, roll, meta, canWrite, onOpen }: { districts: MyDistrictNode[]; roll: RollupResponse["stores"]; meta: DistrictMeta; canWrite: boolean; onOpen: (id: string) => void }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const allStores = districts.flatMap((d) => d.stores);
  const totals = sumRisk(allStores, roll);

  const seed = useMutation({
    mutationFn: seedFromProfiles,
    onSuccess: (r) => { toast.push(`Seeded ${r.created} team member${r.created === 1 ? "" : "s"} from profiles.`, "success"); qc.invalidateQueries({ queryKey: ["tp-rollup"] }); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't seed.", "error"),
  });

  if (importing) return <RosterImport onDone={() => setImporting(false)} />;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-heading">Drive-In Operations</h1>
          <div className="mt-1 text-sm text-ink-muted">
            {allStores.length} store{allStores.length === 1 ? "" : "s"} · {totals.roster.toLocaleString()} team member{totals.roster === 1 ? "" : "s"} · {districts.length} district{districts.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <Button size="sm" variant="primary" onClick={() => setImporting(true)}>
              <Upload className="mr-1 h-3.5 w-3.5" />Import roster
            </Button>
          )}
          {profile?.role === "admin" && (
            <Button size="sm" variant="secondary" disabled={seed.isPending} onClick={() => seed.mutate()}>
              {seed.isPending ? "Seeding…" : "Seed from profiles"}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card">
          <RiskDonut risk={totals.risk} />
          <div>
            <div className="text-3xl font-bold leading-none text-heading">{totals.immediate}</div>
            <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Immediate risk</div>
          </div>
        </div>
        <StatCard value={totals.gmRisk} label="GM seats at risk" tone={totals.gmRisk ? "red" : undefined} />
        <StatCard value={totals.short} label="Open seats vs. sales model" tone={totals.short ? "amber" : undefined} />
        <StatCard value={totals.reqs} label="Open requisitions" />
      </div>

      {profile?.role === "admin" && <StaffingModelSettings />}

      <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Districts</div>
      {districts.length === 0 ? (
        <EmptyState title="No districts in your scope" description="Talent Planning shows the districts and stores you oversee." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {districts.map((d) => {
            const t = sumRisk(d.stores, roll);
            const m = meta.get(d.id);
            const sub = [m?.regionName, m?.doName ? `DO ${m.doName}` : null].filter(Boolean).join(" · ");
            return (
              <button key={d.id} onClick={() => onOpen(d.id)}
                className="group rounded-2xl border border-border bg-surface p-5 text-left shadow-card transition hover:border-accent/60 hover:shadow-float">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-bold tracking-tight text-heading">{d.name || d.code || "District"}</div>
                    {sub && <div className="mt-0.5 truncate text-xs text-ink-muted">{sub}</div>}
                  </div>
                  <RiskDonut risk={t.risk} size={48} stroke={6} />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-semibold text-heading">{d.stores.length}</span><span className="-ml-3 text-ink-muted">stores</span>
                  <span className="font-semibold text-heading">{t.roster}</span><span className="-ml-3 text-ink-muted">team</span>
                  <span className={cn("font-semibold", t.immediate > 0 ? "text-red-600" : "text-heading")}>{t.immediate}</span><span className={cn("-ml-3", t.immediate > 0 ? "text-red-600/80" : "text-ink-muted")}>immediate</span>
                  <span className={cn("font-semibold", t.short > 0 ? "text-amber-600" : "text-heading")}>{t.short}</span><span className={cn("-ml-3", t.short > 0 ? "text-amber-600/80" : "text-ink-muted")}>open seats</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
function StatCard({ value, label, tone }: { value: number | string; label: string; tone?: "red" | "amber" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className={cn("text-3xl font-bold leading-none", tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-heading")}>{value}</div>
      <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">{label}</div>
    </div>
  );
}

// ── Staffing model (admin) ────────────────────────────────────────────────────
function StaffingModelSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["tp-settings"], queryFn: fetchSettings });
  const [val, setVal] = useState("");
  useEffect(() => { if (q.data) setVal(String(q.data.sales_per_member)); }, [q.data]);
  const save = useMutation({
    mutationFn: () => updateSettings(parseInt(val, 10)),
    onSuccess: (r) => {
      toast.push(`Staffing model updated — 1 team member per $${r.sales_per_member.toLocaleString()}.`, "success");
      qc.invalidateQueries({ queryKey: ["tp-settings"] });
      qc.invalidateQueries({ queryKey: ["tp-rollup"] });
      qc.invalidateQueries({ queryKey: ["tp-store-roster"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't save.", "error"),
  });
  if (!q.data?.can_edit) return null;
  const dirty = val !== String(q.data.sales_per_member) && /^\d+$/.test(val) && Number(val) >= 1;
  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-accent" />
        <span className="text-sm font-bold text-heading">Staffing model</span>
        <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Admin</span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">Team members a store needs = weekly sales ÷ this amount, <strong>excluding the GM</strong>. Sales come from Ranker (latest week).</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-ink-2">1 team member per</span>
        <span className="text-ink-muted">$</span>
        <input value={val} inputMode="numeric" onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ""))}
          className="w-28 rounded-lg border border-border bg-surface px-3 py-1.5 font-semibold text-heading focus:border-accent focus:outline-none" />
        <span className="text-ink-muted">in weekly sales</span>
        <Button size="sm" className="ml-1" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── District / GM Bench ──────────────────────────────────────────────────────
type BenchSort = "risk" | "store" | "name";
function District({ district, onOpen }: { district: MyDistrictNode; onOpen: (storeId: string) => void }) {
  const [sort, setSort] = useState<BenchSort>("risk");
  const gmsQ = useQuery({ queryKey: ["tp-gms"], queryFn: fetchGms, staleTime: 60_000 });
  const gmByStore = useMemo(() => {
    const m = new Map<string, TeamMember>();
    for (const g of gmsQ.data?.gms ?? []) m.set(g.store_id, g);
    return m;
  }, [gmsQ.data]);

  // One bench row per store, joined to its GM (if on file).
  const rows = district.stores.map((s) => ({ store: s, gm: gmByStore.get(s.id) ?? null }));
  rows.sort((a, b) => {
    if (sort === "store") return (a.store.name || a.store.number).localeCompare(b.store.name || b.store.number);
    if (sort === "name") return (a.gm?.full_name || "~").localeCompare(b.gm?.full_name || "~");
    return (RISK_RANK[b.gm?.flight_risk ?? "na"] - RISK_RANK[a.gm?.flight_risk ?? "na"]);
  });

  const gmList = rows.map((r) => r.gm).filter(Boolean) as TeamMember[];
  const immediate = gmList.filter((g) => g.flight_risk === "immediate").length;
  const medium = gmList.filter((g) => g.flight_risk === "medium").length;
  const plans = gmList.filter((g) => (g.backfill ?? "").trim().length > 0).length;

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-heading">{district.name || "District"}</h1>
      <div className="mb-5 text-sm text-ink-muted">GM Bench · risk &amp; succession</div>

      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Stores" value={district.stores.length} />
        <Kpi label="GMs immediate risk" value={immediate} tone={immediate ? "red" : undefined} />
        <Kpi label="GMs medium risk" value={medium} />
        <Kpi label="Backfill plans noted" value={plans} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <span className="text-xs font-semibold text-ink-muted">Sort</span>
          {(["risk", "store", "name"] as const).map((k) => (
            <button key={k} onClick={() => setSort(k)}
              className={cn("rounded-full px-3 py-1 text-xs font-semibold capitalize transition",
                sort === k ? "bg-midnight text-white" : "bg-surface-sunk text-ink-muted hover:text-heading")}>{k}</button>
          ))}
        </div>

        {gmsQ.isLoading ? (
          <div className="p-4"><Skeleton className="h-40 w-full" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-ink-subtle">
                  <Th>General Manager</Th><Th>Store</Th><Th>Risk</Th><Th>Reason</Th><Th>Aspiration</Th><Th>Latest comment</Th><Th>Identified backfill</Th><Th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ store, gm }) => (
                  <BenchRow key={store.id} store={store} gm={gm} onOpen={() => onOpen(store.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="border-b border-border bg-surface-muted px-3 py-2.5 font-bold">{children}</th>;
}

function BenchRow({ store, gm, onOpen }: { store: MyStoreNode; gm: TeamMember | null; onOpen: () => void }) {
  const { open } = useMemberDrawer();
  const needsPlan = gm && (gm.flight_risk === "immediate" || gm.flight_risk === "medium") && !(gm.backfill ?? "").trim();
  return (
    <tr className="cursor-pointer transition hover:bg-surface-muted" onClick={onOpen}>
      <td className="border-b border-border px-3 py-3">
        {gm ? (
          <button onClick={(e) => { e.stopPropagation(); open(gm); }}
            className="flex items-center gap-2.5 rounded-lg text-left transition hover:opacity-80" title="Open profile">
            <Avatar name={gm.full_name} risk={gm.flight_risk} />
            <div className="min-w-0">
              <div className="truncate font-semibold text-heading underline-offset-2 hover:underline">{gm.full_name}</div>
              {gm.phone && <div className="text-xs text-ink-muted">{gm.phone}</div>}
            </div>
          </button>
        ) : <span className="text-ink-subtle">No GM on file</span>}
      </td>
      <td className="border-b border-border px-3 py-3">
        <div className="font-medium text-heading">{store.name || `Store #${store.number}`}</div>
        <div className="text-xs text-ink-muted">#{store.number}</div>
      </td>
      <td className="border-b border-border px-3 py-3"><RiskPill risk={gm?.flight_risk ?? "na"} /></td>
      <td className="border-b border-border px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {(gm?.risk_reasons ?? []).map((r) => <span key={r} className="rounded border border-border bg-surface-sunk px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{r}</span>)}
        </div>
      </td>
      <td className="border-b border-border px-3 py-3">
        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", ASPIRATION_META[gm?.aspiration ?? "current"].chip)}>{ASPIRATION_META[gm?.aspiration ?? "current"].label}</span>
      </td>
      <td className="max-w-[240px] border-b border-border px-3 py-3">
        <div className="line-clamp-2 text-xs text-ink-2">{gm?.comment || <span className="text-ink-subtle">—</span>}</div>
      </td>
      <td className="max-w-[200px] border-b border-border px-3 py-3">
        {needsPlan
          ? <span className="rounded bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">No plan — needs one</span>
          : <div className="text-xs text-ink-2">{gm?.backfill || <span className="text-ink-subtle">—</span>}</div>}
      </td>
      <td className="border-b border-border px-3 py-3"><ChevronRight className="h-4 w-4 text-zinc-300" /></td>
    </tr>
  );
}

function Avatar({ name, risk }: { name: string; risk: TeamMember["flight_risk"] }) {
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const ring = { immediate: "ring-red-400", medium: "ring-amber-400", low: "ring-emerald-400", na: "ring-zinc-300" }[risk];
  return <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/10 text-[11px] font-bold text-accent ring-2", ring)}>{initials}</span>;
}

function RiskPill({ risk }: { risk: TeamMember["flight_risk"] }) {
  const m = RISK_META[risk];
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", m.chip)}><span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />{m.short}</span>;
}

// ── Store (layouts) ──────────────────────────────────────────────────────────
type Layout = "ladder" | "roster" | "ninebox" | "plan";
function Store({ store }: { store: MyStoreNode }) {
  const [layout, setLayout] = useState<Layout>("ladder");
  const rosterQ = useQuery({ queryKey: ["tp-store-roster", store.id], queryFn: () => fetchStoreRoster(store.id) });
  const roster = rosterQ.data?.roster ?? [];
  const terminated = rosterQ.data?.terminated ?? [];
  const reqs = rosterQ.data?.reqs ?? [];
  const canWrite = rosterQ.data?.can_write ?? false;
  const salesTarget = rosterQ.data?.target ?? null;
  const weeklySales = rosterQ.data?.weekly_sales ?? null;
  const salesPerMember = rosterQ.data?.sales_per_member ?? 1200;
  const nonGmHave = roster.filter((m) => m.role !== "gm").length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-heading">{store.name || `Store #${store.number}`}</h1>
          <div className="text-sm text-ink-muted">
            Store #{store.number} · {roster.length} team member{roster.length === 1 ? "" : "s"}
            {salesTarget != null && (
              <> · <span className={cn("font-semibold", nonGmHave < salesTarget ? "text-red-600" : "text-emerald-600")}>
                {nonGmHave}/{salesTarget} staffed{nonGmHave < salesTarget ? ` (${salesTarget - nonGmHave} short)` : ""}
              </span> <span className="text-ink-subtle">excl GM</span></>
            )}
          </div>
        </div>
        <Segmented<Layout>
          options={[{ value: "ladder", label: "Bench ladder" }, { value: "roster", label: "Roster" }, { value: "ninebox", label: "9-box" }, { value: "plan", label: "Staffing plan" }]}
          value={layout} onChange={setLayout} />
      </div>

      {canWrite && <DuplicatesBanner storeId={store.id} roster={roster} />}
      {reqs.length > 0 && <ReqsPanel storeId={store.id} reqs={reqs} canWrite={canWrite} />}

      {rosterQ.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : layout === "plan" ? (
        <StaffingPlanner storeId={store.id} roster={roster} salesTarget={salesTarget} weeklySales={weeklySales} salesPerMember={salesPerMember} />
      ) : roster.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface-muted px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-accent"><Users className="h-6 w-6" /></span>
          <div className="text-base font-semibold text-heading">No team members yet</div>
          <p className="max-w-md text-sm text-ink-muted">This store's roster is empty. It fills from the ATS import (or the admin "Seed from profiles" action).</p>
        </div>
      ) : layout === "ladder" ? (
        <BenchLadder roster={roster} />
      ) : layout === "roster" ? (
        <RosterTable roster={roster} />
      ) : (
        <NineBox roster={roster} storeId={store.id} />
      )}

      {terminated.length > 0 && <TerminatedPanel storeId={store.id} members={terminated} canWrite={canWrite} />}
    </>
  );
}

// ── Terminated (out of pipeline, kept for rehire/history) ─────────────────────
function TerminatedPanel({ storeId, members, canWrite }: { storeId: string; members: TeamMember[]; canWrite: boolean }) {
  const { open } = useMemberDrawer();
  const qc = useQueryClient();
  const toast = useToast();
  const [show, setShow] = useState(false);
  const reactivate = useMutation({
    mutationFn: (id: string) => updateMember(id, { status: "active" }),
    onSuccess: () => {
      toast.push("Reactivated — back in the pipeline.", "success");
      qc.invalidateQueries({ queryKey: ["tp-store-roster", storeId] });
      qc.invalidateQueries({ queryKey: ["tp-rollup"] });
      qc.invalidateQueries({ queryKey: ["tp-gms"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't reactivate.", "error"),
  });

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <button onClick={() => setShow((s) => !s)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <Archive className="h-4 w-4 text-ink-subtle" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Terminated · {members.length}</span>
        <ChevronRight className={cn("ml-auto h-4 w-4 text-ink-subtle transition", show && "rotate-90")} />
      </button>
      {show && (
        <ul className="divide-y divide-border border-t border-border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <button onClick={() => open(m)} className="text-left text-sm font-semibold text-heading hover:underline">{m.full_name}</button>
              <span className="text-xs text-ink-muted">{LADDER_BY_KEY[m.role]?.label ?? m.role}</span>
              {!m.has_account && <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" title="No account" />}
              {canWrite && (
                <button disabled={reactivate.isPending} onClick={() => reactivate.mutate(m.id)}
                  className="ml-auto rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-surface-sunk disabled:opacity-40">
                  Reactivate
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Duplicate records (seed vs. bulk import) ──────────────────────────────────
function DuplicatesBanner({ storeId, roster }: { storeId: string; roster: TeamMember[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const groups = useMemo(() => {
    const map = new Map<string, TeamMember[]>();
    for (const m of roster) {
      const k = m.full_name.trim().toLowerCase().replace(/\s+/g, " ");
      if (!k) continue;
      (map.get(k) ?? map.set(k, []).get(k)!).push(m);
    }
    return [...map.values()].filter((g) => g.length > 1);
  }, [roster]);

  const merge = useMutation({
    mutationFn: async (group: TeamMember[]) => {
      const keep = group.find((m) => m.has_account) ?? group[0];
      for (const d of group) if (d.id !== keep.id) await mergeMembers(keep.id, d.id);
    },
    onSuccess: () => {
      toast.push("Records merged.", "success");
      qc.invalidateQueries({ queryKey: ["tp-store-roster", storeId] });
      qc.invalidateQueries({ queryKey: ["tp-rollup"] });
      qc.invalidateQueries({ queryKey: ["tp-gms"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't merge.", "error"),
  });

  if (groups.length === 0) return null;
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-900">
        <Users className="h-4 w-4" />Possible duplicate{groups.length === 1 ? "" : "s"} · {groups.length}
      </div>
      <p className="mb-3 text-xs text-amber-800">Same name from both the profile seed and the bulk import. Merging keeps the record with an account and folds in the other's ATS data, notes, and write-ups.</p>
      <ul className="flex flex-col gap-2">
        {groups.map((g) => {
          const keep = g.find((m) => m.has_account) ?? g[0];
          return (
            <li key={keep.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-surface px-3 py-2">
              <span className="text-sm font-semibold text-heading">{keep.full_name}</span>
              <span className="text-xs text-ink-muted">{g.length} records · {g.map((m) => LADDER_BY_KEY[m.role]?.abbr ?? m.role).join(" / ")}</span>
              <AccountBadge has={g.some((m) => m.has_account)} />
              <button disabled={merge.isPending} onClick={() => merge.mutate(g)}
                className="ml-auto rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-40">
                {merge.isPending ? "Merging…" : "Merge"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Open requisitions ─────────────────────────────────────────────────────────
const REQ_FLOW: Requisition["status"][] = ["sourcing", "interviewing", "offer", "filled"];
function ReqsPanel({ storeId, reqs, canWrite }: { storeId: string; reqs: Requisition[]; canWrite: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const mut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status?: Requisition["status"]; candidates?: number } }) => updateReq(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tp-store-roster", storeId] });
      qc.invalidateQueries({ queryKey: ["tp-rollup"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't update req.", "error"),
  });
  const advance = (r: Requisition) => {
    const next = REQ_FLOW[Math.min(REQ_FLOW.indexOf(r.status) + 1, REQ_FLOW.length - 1)];
    if (next !== r.status) mut.mutate({ id: r.id, patch: { status: next } });
  };

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">
        Open requisitions · {reqs.length}
      </div>
      <ul className="divide-y divide-border">
        {reqs.map((r) => {
          const meta = REQ_STATUS_META[r.status];
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-[140px]">
                <div className="text-sm font-semibold text-heading">{LADDER_BY_KEY[r.role]?.label ?? r.role}</div>
                <div className="text-xs text-ink-muted">{r.ref ?? "—"}{r.reason ? ` · ${r.reason}` : ""}</div>
              </div>
              <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", meta.chip)}>{meta.label}</span>
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span className="font-semibold tabular-nums text-heading">{r.candidates}</span> candidate{r.candidates === 1 ? "" : "s"}
                {canWrite && (
                  <span className="ml-1 inline-flex gap-1">
                    <Mini onClick={() => mut.mutate({ id: r.id, patch: { candidates: Math.max(0, r.candidates - 1) } })}>−</Mini>
                    <Mini onClick={() => mut.mutate({ id: r.id, patch: { candidates: r.candidates + 1 } })}>+</Mini>
                  </span>
                )}
              </div>
              {canWrite && r.status !== "filled" && (
                <div className="ml-auto flex gap-2">
                  <button onClick={() => advance(r)} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2 transition hover:bg-surface-sunk">
                    Advance → {REQ_STATUS_META[REQ_FLOW[Math.min(REQ_FLOW.indexOf(r.status) + 1, 3)]].label}
                  </button>
                  <button onClick={() => mut.mutate({ id: r.id, patch: { status: "filled" } })} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700">
                    Mark filled
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
function Mini({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="grid h-5 w-5 place-items-center rounded border border-border bg-surface text-ink-muted hover:bg-surface-sunk">{children}</button>;
}

// ── Bench ladder ─────────────────────────────────────────────────────────────
function BenchLadder({ roster }: { roster: TeamMember[] }) {
  const { open } = useMemberDrawer();
  const byRole = (key: TeamMember["role"]) => roster.filter((m) => m.role === key);
  const mgrRoles = [...LADDER].filter((r) => r.mgr).reverse(); // GM → Shift
  const entryRoles = [...LADDER].filter((r) => !r.mgr).reverse(); // CL → CM → CH

  return (
    <div className="flex flex-col gap-3">
      {mgrRoles.map((r) => {
        const people = byRole(r.key);
        return (
          <div key={r.key} className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card sm:grid-cols-[180px_1fr]">
            <div>
              <div className="text-sm font-bold text-heading">{r.label}</div>
              <div className="text-xs text-ink-muted">{people.length} on bench</div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {people.length === 0 ? (
                <span className="text-sm text-ink-subtle">— no one in this seat</span>
              ) : people.map((m) => (
                <button key={m.id} onClick={() => open(m)} className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 text-left transition hover:border-accent/60 hover:bg-surface-muted">
                  <Avatar name={m.full_name} risk={m.flight_risk} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-heading">{m.full_name}</div>
                    <div className="mt-0.5 flex gap-1.5">
                      <RiskPill risk={m.flight_risk} />
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset", ASPIRATION_META[m.aspiration].chip)}>{ASPIRATION_META[m.aspiration].label}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div className="mt-2 text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Crew &amp; Carhops</div>
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        {entryRoles.map((r) => {
          const people = byRole(r.key);
          return (
            <div key={r.key} className="mb-3 last:mb-0">
              <div className="mb-1.5 text-xs font-semibold text-ink-muted">{r.label} · {people.length}</div>
              <div className="flex flex-wrap gap-2">
                {people.length === 0 ? <span className="text-xs text-ink-subtle">—</span> : people.map((m) => (
                  <button key={m.id} onClick={() => open(m)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-1 text-xs font-medium text-heading transition hover:border-accent/60 hover:bg-surface-muted">
                    {m.flight_risk === "immediate" && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                    {m.full_name.split(" ")[0]} {m.full_name.split(" ").slice(-1)[0]?.[0] ?? ""}.
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Roster table ─────────────────────────────────────────────────────────────
function RosterTable({ roster }: { roster: TeamMember[] }) {
  const [filter, setFilter] = useState<TeamMember["role"] | "all">("all");
  const present = [...LADDER].filter((r) => roster.some((m) => m.role === r.key));
  const order = Object.fromEntries(LADDER.map((r, i) => [r.key, i]));
  const rows = roster
    .filter((m) => filter === "all" || m.role === filter)
    .sort((a, b) => (order[b.role] - order[a.role]) || (RISK_RANK[b.flight_risk] - RISK_RANK[a.flight_risk]) || a.full_name.localeCompare(b.full_name));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <FilterChip on={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
        {present.map((r) => <FilterChip key={r.key} on={filter === r.key} onClick={() => setFilter(r.key)}>{r.label}</FilterChip>)}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="grid grid-cols-[1.6fr_1fr_1fr_0.8fr] gap-3 border-b border-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">
          <span>Team member</span><span>Risk</span><span>Aspiration</span><span>Perf</span>
        </div>
        {rows.map((m) => <RosterRow key={m.id} m={m} />)}
      </div>
    </div>
  );
}
function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold transition",
      on ? "bg-midnight text-white" : "bg-surface-sunk text-ink-muted hover:text-heading")}>{children}</button>
  );
}

// ── 9-box (Sonic Calibration grid) ───────────────────────────────────────────
// Column = performance (Low/Moderate/High →), row = potential (High/Moderate/
// Low ↓, high at top). Each cell carries the Sonic 9-Box calibration
// name + coaching blurb + color, so the grid IS the reference chart and the
// avatars land in their box. Ratings (1–5) bucket into 3 bands.
const NB_COLS = ["Low", "Moderate", "High"];    // performance →
const NB_ROWS = ["High", "Moderate", "Low"];    // potential ↓ (high at top)
const NB_COL_SUB = ["Partially meets / strays", "Meets expectations", "Exceptional / exceeds"];
const NB_ROW_SUB = ["Exceptional alignment", "Grows with support", "Strays from values"];
const perfCol = (p: number) => (p >= 4 ? 2 : p === 3 ? 1 : 0);
const potRow = (p: number) => (p >= 4 ? 0 : p === 3 ? 1 : 2);

interface NbCell { title: string; desc: string[]; cls: string; icon?: "star" | "warn" }
// Indexed [row][col] — row 0 = High potential (top), col 0 = Low performance.
const NINE_BOX: NbCell[][] = [
  [
    { title: "Potential Gem", cls: "bg-emerald-600", desc: ["High values alignment", "Needs execution coaching"] },
    { title: "High Potential", cls: "bg-blue-600", desc: ["Emerging leader", "Developing execution strength"] },
    { title: "Star", cls: "bg-blue-800", icon: "star", desc: ["Crushes targets, inspires culture", "Ready now for next role"] },
  ],
  [
    { title: "Inconsistent Player", cls: "bg-red-400", desc: ["In and out of expectations", "Needs accountability + planning"] },
    { title: "Core Player", cls: "bg-emerald-600", desc: ["Consistent contributor", "Growth potential with support"] },
    { title: "High Performer", cls: "bg-blue-600", desc: ["Hits goals consistently", "Needs growth in team coaching / values leadership"] },
  ],
  [
    { title: "Risk", cls: "bg-red-500", icon: "warn", desc: ["Misaligned on results and leadership", "May require exit or reset"] },
    { title: "Average Performer", cls: "bg-red-400", desc: ["Hits minimums", "Lacks engagement or coaching presence"] },
    { title: "Solid Performer", cls: "bg-emerald-600", desc: ["Delivers results", "Misses on leadership, feedback, or culture"] },
  ],
];

// Box "goodness" score (0–4): higher performance + higher potential = higher.
// Used only to classify movement direction between two snapshots.
const potGood = (p: number) => 2 - potRow(p); // high potential → 2
const boxScore = (perf: number, pot: number) => perfCol(perf) + potGood(pot);
type MoveKind = "up" | "down" | "lateral" | "same" | "new";
const MOVE_META: Record<Exclude<MoveKind, "same" | "new">, { badge: string; cls: string }> = {
  up: { badge: "▲", cls: "bg-emerald-500 text-white" },
  down: { badge: "▼", cls: "bg-red-500 text-white" },
  lateral: { badge: "→", cls: "bg-amber-400 text-white" },
};

function NineBox({ roster, storeId }: { roster: TeamMember[]; storeId: string }) {
  const { open } = useMemberDrawer();
  const rated = roster.filter((m) => m.perf != null && m.potential != null);
  const cellOf = (col: number, row: number) => rated.filter((m) => perfCol(m.perf!) === col && potRow(m.potential!) === row);
  const unrated = roster.length - rated.length;

  // Calibration compare: overlay each member's movement since a prior snapshot.
  const [compare, setCompare] = useState<string>("");
  const rowsQ = useQuery({
    queryKey: ["tp-snapshot-rows", compare, storeId],
    queryFn: () => fetchSnapshotRows(compare, storeId),
    enabled: !!compare,
    staleTime: 60_000,
  });
  const priorByMember = useMemo(() => {
    const m = new Map<string, SnapshotRow>();
    for (const r of rowsQ.data?.rows ?? []) m.set(r.member_id, r);
    return m;
  }, [rowsQ.data]);
  const moveOf = (mem: TeamMember): MoveKind => {
    if (!compare || !rowsQ.data) return "same"; // no compare, or snapshot still loading
    const prior = priorByMember.get(mem.id);
    if (!prior || prior.perf == null || prior.potential == null) return "new";
    const sameBox = perfCol(prior.perf) === perfCol(mem.perf!) && potRow(prior.potential) === potRow(mem.potential!);
    if (sameBox) return "same";
    const d = boxScore(mem.perf!, mem.potential!) - boxScore(prior.perf, prior.potential);
    return d > 0 ? "up" : d < 0 ? "down" : "lateral";
  };
  const movers = compare ? rated.filter((m) => { const k = moveOf(m); return k === "up" || k === "down" || k === "lateral" || k === "new"; }).length : 0;

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-ink-muted">
        The <strong className="text-ink-2">Sonic 9-Box</strong> calibrates team members on two dimensions —{" "}
        <strong className="text-ink-2">performance</strong> (→) and <strong className="text-ink-2">potential</strong> (↓) — to
        spot future leaders, recognize top performers, and target coaching where it lands hardest. Each person sits in a box
        by their rating; tap an avatar to open their card.
      </p>

      <CalibrationBar compare={compare} onCompare={setCompare} movers={movers} />

      <div className="overflow-x-auto">
        <div className="flex min-w-[720px] gap-2">
          {/* potential axis label */}
          <div className="flex w-6 items-center justify-center">
            <span className="[writing-mode:vertical-rl] rotate-180 text-[11px] font-bold uppercase tracking-widest text-ink-subtle">Potential</span>
          </div>
          {/* row labels */}
          <div className="grid w-32 shrink-0 grid-rows-3 gap-2 pt-0">
            {NB_ROWS.map((l, i) => (
              <div key={l} className="flex flex-col justify-center rounded-lg bg-surface-muted px-2 text-center">
                <div className="text-xs font-bold text-heading">{l} Potential</div>
                <div className="text-[10px] leading-tight text-ink-muted">{NB_ROW_SUB[i]}</div>
              </div>
            ))}
          </div>
          {/* grid */}
          <div className="flex-1">
            <div className="grid grid-cols-3 gap-2" style={{ gridTemplateRows: "repeat(3, minmax(150px, auto))" }}>
              {NINE_BOX.map((rowCells, row) => rowCells.map((cell, col) => {
                const people = cellOf(col, row);
                return (
                  <div key={`${row}-${col}`} className={cn("flex flex-col gap-1.5 overflow-hidden rounded-xl p-2.5 text-white", cell.cls)}>
                    <div className="text-[13px] font-extrabold leading-tight">
                      {cell.icon === "star" && "⭐ "}
                      {cell.icon === "warn" && "⚠️ "}
                      {cell.title}
                    </div>
                    <ul className="space-y-0.5 text-[11px] leading-snug text-white/90">
                      {cell.desc.map((d) => <li key={d}>• {d}</li>)}
                    </ul>
                    {people.length > 0 && (
                      <div className="mt-auto flex flex-wrap content-start gap-1 pt-1">
                        {people.map((m) => {
                          const mv = moveOf(m);
                          const badge = mv === "new" ? "✦" : mv === "same" ? null : MOVE_META[mv].badge;
                          const badgeCls = mv === "new" ? "bg-blue-600 text-white" : mv === "same" ? "" : MOVE_META[mv].cls;
                          const mvTitle = mv === "new" ? " · new since " + compare : mv === "same" ? "" : ` · moved ${mv} since ${compare}`;
                          return (
                            <button key={m.id} onClick={() => open(m)} title={`${m.full_name} · ${LADDER_BY_KEY[m.role]?.abbr}${mvTitle}`}
                              className="relative rounded-full ring-2 ring-white/70 transition hover:ring-white">
                              <Avatar name={m.full_name} risk={m.flight_risk} />
                              {badge && (
                                <span className={cn("absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full text-[8px] font-bold leading-none ring-1 ring-white", badgeCls)}>{badge}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }))}
            </div>
            {/* column labels */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              {NB_COLS.map((l, i) => (
                <div key={l} className="rounded-lg bg-surface-muted px-2 py-1 text-center">
                  <div className="text-xs font-bold text-heading">{l} Performance</div>
                  <div className="text-[10px] leading-tight text-ink-muted">{NB_COL_SUB[i]}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-center text-[11px] font-bold uppercase tracking-widest text-ink-subtle">Performance →</div>
          </div>
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        Avatar ring color = risk.{unrated > 0 ? ` ${unrated} team member${unrated === 1 ? "" : "s"} not yet rated — set Performance + Potential on their card to place them.` : ""}
        {compare && (
          <span className="ml-1">Comparing to <strong className="text-ink-2">{compare}</strong>: <span className="font-bold text-emerald-600">▲</span> moved up · <span className="font-bold text-red-600">▼</span> down · <span className="font-bold text-amber-600">→</span> lateral · <span className="font-bold text-blue-600">✦</span> new.</span>
        )}
      </p>
    </div>
  );
}

// Compact calibration strip above the 9-box: pick a prior snapshot to compare
// against (everyone), and — for org-wide roles — take / lock company snapshots.
function currentQuarter(): string {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}
function CalibrationBar({ compare, onCompare, movers }: {
  compare: string; onCompare: (p: string) => void; movers: number;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["tp-snapshots"], queryFn: fetchSnapshots, staleTime: 60_000 });
  const snapshots = q.data?.snapshots ?? [];
  const canManage = q.data?.can_manage ?? false;
  const period = currentQuarter();
  const thisPeriod = snapshots.find((s) => s.period === period);
  const compareSnap = snapshots.find((s) => s.period === compare) ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tp-snapshots"] });
    qc.invalidateQueries({ queryKey: ["tp-snapshot-rows"] });
  };
  const take = useMutation({
    mutationFn: () => takeSnapshot(period),
    onSuccess: (r) => { toast.push(`${r.replaced ? "Updated" : "Captured"} ${period} — ${r.member_count} people.`, "success"); invalidate(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't snapshot.", "error"),
  });
  const lock = useMutation({
    mutationFn: (p: string) => lockSnapshot(p),
    onSuccess: (r) => { toast.push(`${r.period} locked.`, "success"); invalidate(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't lock.", "error"),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-muted px-3 py-2">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Calibration</span>
      <label className="flex items-center gap-1.5 text-xs text-ink-2">
        Compare to
        <select value={compare} onChange={(e) => onCompare(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1 text-xs font-semibold text-heading focus:border-accent focus:outline-none">
          <option value="">Live (no compare)</option>
          {snapshots.map((s) => <option key={s.period} value={s.period}>{s.period}{s.status === "locked" ? " 🔒" : ""}</option>)}
        </select>
      </label>
      {compare && (
        <span className="text-[11px] text-ink-muted">
          {movers > 0 ? `${movers} moved` : "no movement"}{compareSnap?.locked_at ? " · locked" : ""}
        </span>
      )}
      {canManage && (
        <div className="ml-auto flex items-center gap-1.5">
          <button disabled={take.isPending || thisPeriod?.status === "locked"} onClick={() => take.mutate()}
            title={thisPeriod?.status === "locked" ? `${period} is locked` : `Snapshot all stores for ${period}`}
            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-surface-sunk disabled:opacity-40">
            {take.isPending ? "Snapshotting…" : thisPeriod ? `Re-snapshot ${period}` : `Snapshot ${period}`}
          </button>
          {compareSnap && compareSnap.status === "open" && (
            <button disabled={lock.isPending} onClick={() => lock.mutate(compareSnap.period)}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink-2 transition hover:bg-surface-sunk disabled:opacity-40">
              <Lock className="h-3 w-3" />Lock {compareSnap.period}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Staffing planner ─────────────────────────────────────────────────────────
type Promo = { member: TeamMember; toRole: LadderKey };
function StaffingPlanner({ storeId, roster, salesTarget, weeklySales, salesPerMember }: { storeId: string; roster: TeamMember[]; salesTarget: number | null; weeklySales: number | null; salesPerMember: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  // Sales-driven model: total team target (excl GM) = ceil(sales / divisor),
  // distributed across non-GM roles by ROLE_MIX. GM is its own seat (1). Each
  // per-role row is still adjustable.
  const totalTarget = salesTarget ?? 0;
  const baseTarget = (k: LadderKey) => (k === "gm" ? 1 : Math.round(totalTarget * (ROLE_MIX[k as Exclude<LadderKey, "gm">] ?? 0)));

  const [targets, setTargets] = useState<Partial<Record<LadderKey, number>>>({});
  const [hires, setHires] = useState<Record<string, number>>({});
  const [promos, setPromos] = useState<Promo[]>([]);
  const [holds, setHolds] = useState<Record<string, boolean>>({});
  const [adjust, setAdjust] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState<LadderKey | null>(null);

  const active = roster.filter((m) => m.status !== "loa");
  const have = (k: LadderKey) => active.filter((m) => m.role === k).length;
  const nonGmHave = active.filter((m) => m.role !== "gm").length;
  const target = (k: LadderKey) => targets[k] ?? baseTarget(k);
  const promoIn = (k: LadderKey) => promos.filter((p) => p.toRole === k).length;
  const promoOut = (k: LadderKey) => promos.filter((p) => p.member.role === k).length;
  const projected = (k: LadderKey) => have(k) + (hires[k] || 0) + promoIn(k) - promoOut(k);
  const stateOf = (k: LadderKey): "short" | "ok" | "over" | "hold" => {
    if (holds[k]) return "hold";
    const g = projected(k) - target(k);
    return g < 0 ? "short" : g > 0 ? "over" : "ok";
  };

  const rolesTopDown = [...LADDER].reverse();
  const openNow = LADDER.reduce((n, r) => n + Math.max(0, baseTarget(r.key) - have(r.key)), 0);
  const openAfter = LADDER.reduce((n, r) => n + (holds[r.key] ? 0 : Math.max(0, target(r.key) - projected(r.key))), 0);
  const reqsToOpen = Object.values(hires).reduce((a, b) => a + b, 0);
  const hasActions = reqsToOpen > 0 || promos.length > 0;

  const commit = useMutation({
    mutationFn: () => commitPlan({ store_id: storeId, hires, promotions: promos.map((p) => ({ member_id: p.member.id, to_role: p.toRole })) }),
    onSuccess: (r) => {
      toast.push(`Plan committed — ${r.promoted} promoted, ${r.reqs_opened} req${r.reqs_opened === 1 ? "" : "s"} opened.`, "success");
      setHires({}); setPromos([]); setHolds({}); setAdjust({}); setPicking(null); setTargets({});
      qc.invalidateQueries({ queryKey: ["tp-store-roster", storeId] });
      qc.invalidateQueries({ queryKey: ["tp-rollup"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't commit the plan.", "error"),
  });

  const setHire = (k: LadderKey, d: number) => setHires((h) => ({ ...h, [k]: Math.max(0, (h[k] || 0) + d) }));
  const addPromo = (member: TeamMember, toRole: LadderKey) => { setPromos((p) => [...p, { member, toRole }]); setPicking(null); };
  const removePromo = (id: string) => setPromos((p) => p.filter((x) => x.member.id !== id));

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-border bg-surface-muted px-3.5 py-2 text-[12.5px] font-medium text-ink-2">
        {weeklySales != null
          ? <>Target = weekly sales <strong>${weeklySales.toLocaleString()}</strong> ÷ <strong>${salesPerMember.toLocaleString()}</strong> per team member = <strong>{totalTarget}</strong> needed <span className="text-ink-muted">(excludes GM)</span>. Per-role split is a starting point — adjust any row.</>
          : <>Sales data isn't available from Ranker for this store, so the target is 0. Targets come from weekly sales ÷ ${salesPerMember.toLocaleString()} per team member (excl GM).</>}
      </div>

      {/* summary */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
        <div>
          <div className="text-sm font-bold text-heading">Needs {totalTarget} team member{totalTarget === 1 ? "" : "s"} <span className="font-medium text-ink-muted">(excl GM)</span></div>
          <div className="text-xs text-ink-muted">{nonGmHave} on staff today{nonGmHave < totalTarget ? ` · ${totalTarget - nonGmHave} short` : nonGmHave > totalTarget ? ` · ${nonGmHave - totalTarget} over` : " · on target"}</div>
        </div>
        <div className="flex items-center gap-5">
          <Metric n={openNow} label="Open now" />
          <span className="text-ink-subtle">→</span>
          <Metric n={openAfter} label="After plan" tone={openAfter < openNow ? "good" : undefined} />
          <Metric n={reqsToOpen} label="Reqs to open" />
          <Metric n={promos.length} label="Promotions" />
        </div>
        <Button className="ml-auto" disabled={!hasActions || commit.isPending} onClick={() => commit.mutate()}>
          {commit.isPending ? "Committing…" : "Commit plan"}
        </Button>
      </div>

      {/* per-role rows */}
      {rolesTopDown.map((r) => {
        const k = r.key as LadderKey;
        const st = stateOf(k);
        const below = roleBelow(k);
        const candidates = below ? active.filter((m) => m.role === below && !promos.some((p) => p.member.id === m.id)) : [];
        const atRisk = active.filter((m) => m.role === k && m.flight_risk === "immediate").length;
        const gap = projected(k) - target(k);
        const border = { short: "border-l-red-500", ok: "border-l-emerald-500", over: "border-l-blue-500", hold: "border-l-zinc-400" }[st];
        return (
          <div key={k} className={cn("rounded-2xl border border-l-[3px] border-border bg-surface p-4 shadow-card", border)}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="min-w-[150px]">
                <div className="text-sm font-bold text-heading">{r.label}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                  {r.abbr}{atRisk > 0 && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{atRisk} at risk</span>}
                </div>
              </div>

              <div className="flex items-center gap-5">
                <NumCell label="Target">
                  {adjust[k] ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Stepper onClick={() => setTargets((t) => ({ ...t, [k]: Math.max(0, target(k) - 1) }))}>−</Stepper>
                      <span className="min-w-5 text-center text-lg font-bold tabular-nums">{target(k)}</span>
                      <Stepper onClick={() => setTargets((t) => ({ ...t, [k]: target(k) + 1 }))}>+</Stepper>
                    </span>
                  ) : <span className="text-lg font-bold tabular-nums">{target(k)}{targets[k] != null && <span className="text-amber-500">*</span>}</span>}
                </NumCell>
                <NumCell label="Have"><span className="text-lg font-bold tabular-nums text-heading">{have(k)}</span></NumCell>
                <NumCell label="Projected">
                  <span className={cn("text-lg font-bold tabular-nums", st === "short" ? "text-red-600" : st === "over" ? "text-blue-600" : st === "ok" ? "text-emerald-600" : "text-ink-muted")}>{projected(k)}</span>
                </NumCell>
                <GapBadge state={st} gap={gap} />
              </div>

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {(hires[k] || 0) > 0 && <Chip tone="hire">{hires[k]} new req{hires[k] === 1 ? "" : "s"}<X onClick={() => setHires((h) => ({ ...h, [k]: 0 }))} /></Chip>}
                {promos.filter((p) => p.toRole === k).map((p) => <Chip key={p.member.id} tone="promo">↑ {p.member.full_name.split(" ")[0]}<X onClick={() => removePromo(p.member.id)} /></Chip>)}
                {promos.filter((p) => p.member.role === k).map((p) => <Chip key={p.member.id} tone="out">→ {p.member.full_name.split(" ")[0]} to {LADDER_BY_KEY[p.toRole].abbr}<X onClick={() => removePromo(p.member.id)} /></Chip>)}
                <PlanBtn onClick={() => setHire(k, 1)}>+ Open req</PlanBtn>
                {below && <PlanBtn disabled={candidates.length === 0} on={picking === k} onClick={() => setPicking(picking === k ? null : k)}>↑ Promote {LADDER_BY_KEY[below].abbr}</PlanBtn>}
                <PlanBtn on={!!adjust[k]} onClick={() => setAdjust((a) => ({ ...a, [k]: !a[k] }))}>Adjust target</PlanBtn>
                <PlanBtn on={!!holds[k]} onClick={() => setHolds((h) => ({ ...h, [k]: !h[k] }))}>Hold</PlanBtn>
              </div>
            </div>

            {picking === k && below && (
              <div className="mt-3 rounded-xl border border-border bg-surface-muted p-3">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-muted">Promote from {LADDER_BY_KEY[below].label}</div>
                {candidates.length === 0 ? <div className="text-sm text-ink-subtle">No eligible candidates in the role below.</div> : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {candidates.map((m) => (
                      <button key={m.id} onClick={() => addPromo(m, k)} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface p-2.5 text-left transition hover:border-accent/60">
                        <Avatar name={m.full_name} risk={m.flight_risk} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-heading">{m.full_name}</div>
                          <div className="text-xs text-ink-muted">{m.perf ? `Perf ${m.perf}/5` : "Unrated"} · {ASPIRATION_META[m.aspiration].label}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function Metric({ n, label, tone }: { n: number; label: string; tone?: "good" }) {
  return <div className="text-center"><div className={cn("text-xl font-bold tabular-nums leading-none", tone === "good" ? "text-emerald-600" : "text-heading")}>{n}</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</div></div>;
}
function NumCell({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="text-center"><div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{label}</div>{children}</div>;
}
function Stepper({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="grid h-6 w-6 place-items-center rounded-md border border-border bg-surface text-ink-muted hover:bg-surface-sunk">{children}</button>;
}
function GapBadge({ state, gap }: { state: "short" | "ok" | "over" | "hold"; gap: number }) {
  const map = {
    short: { c: "bg-red-50 text-red-700", t: `short ${-gap}` },
    ok: { c: "bg-emerald-50 text-emerald-700", t: "on target ✓" },
    over: { c: "bg-blue-50 text-blue-700", t: `+${gap} over` },
    hold: { c: "bg-zinc-100 text-zinc-600", t: "On hold" },
  }[state];
  return <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", map.c)}>{map.t}</span>;
}
function PlanBtn({ children, onClick, on, disabled }: { children: React.ReactNode; onClick: () => void; on?: boolean; disabled?: boolean }) {
  return <button disabled={disabled} onClick={onClick} className={cn("rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-40", on ? "border-accent bg-accent/10 text-accent" : "border-border bg-surface text-ink-2 hover:bg-surface-sunk")}>{children}</button>;
}
function Chip({ tone, children }: { tone: "hire" | "promo" | "out"; children: React.ReactNode }) {
  const c = { hire: "bg-blue-50 text-blue-700", promo: "bg-emerald-50 text-emerald-700", out: "bg-zinc-100 text-zinc-600" }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", c)}>{children}</span>;
}
function X({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="ml-0.5 opacity-60 hover:opacity-100">×</button>;
}

function RosterRow({ m }: { m: TeamMember }) {
  const { open } = useMemberDrawer();
  const risk = RISK_META[m.flight_risk];
  const asp = ASPIRATION_META[m.aspiration];
  return (
    <div role="button" tabIndex={0} onClick={() => open(m)} onKeyDown={(e) => { if (e.key === "Enter") open(m); }}
      className="grid cursor-pointer grid-cols-[1.6fr_1fr_1fr_0.8fr] items-center gap-3 border-b border-border px-4 py-3 transition last:border-b-0 hover:bg-surface-muted">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-heading">{m.full_name}</span>
          {m.status === "loa" && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-500">LOA</span>}
          {!m.has_account && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300" title="No account" />}
        </div>
        <div className="text-xs text-ink-muted">{LADDER_BY_KEY[m.role]?.label ?? m.role}</div>
      </div>
      <div>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", risk.chip)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", risk.dot)} />{risk.short}
        </span>
      </div>
      <div>
        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", asp.chip)}>{asp.label}</span>
      </div>
      <div className="text-sm tabular-nums text-ink-muted">{m.perf ? `${m.perf}/5` : "—"}</div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: "red" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className={cn("text-2xl font-bold tabular-nums leading-none", tone === "red" ? "text-red-600" : "text-heading")}>{value}</div>
      <div className="mt-1.5 text-xs text-ink-muted">{label}</div>
    </div>
  );
}
