// Team Pipeline — Talent Planning. A scoped Company → District → Store
// drill-down on the viewer's RLS-scoped org tree (fetchMyTree), overlaid with
// talent roll-ups (flight risk, roster size, open reqs) from team-pipeline.js.
// The richer store layouts (bench ladder, 9-box, staffing planner) and the
// GM bench / corrective-action documents build out in later slices.
//
// Gated behind the `team_pipeline` feature flag (see router + nav).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronRight, Lock, SlidersHorizontal, Upload, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Segmented } from "@/shared/ui/Segmented";
import { useToast } from "@/shared/ui/Toaster";
import { fetchMyTree } from "@/modules/my-stores/api";
import type { MyDistrictNode, MyStoreNode } from "@/modules/my-stores/types";
import { fetchGms, fetchRollup, fetchStoreRoster, seedFromProfiles, commitPlan, updateReq, updateMember, mergeMembers, fetchSettings, updateSettings } from "./api";
import { AccountBadge, MemberDrawerProvider, useMemberDrawer } from "./MemberDrawer";
import { RosterImport } from "./RosterImport";
import {
  ASPIRATION_META, LADDER, LADDER_BY_KEY, REQ_STATUS_META, RISK_META, ROLE_MIX, roleBelow,
  type LadderKey, type Requisition, type RiskCounts, type RollupResponse, type StoreRollup, type TeamMember,
} from "./types";

type Nav =
  | { level: "company" }
  | { level: "district"; districtId: string }
  | { level: "store"; districtId: string; storeId: string };

const ZERO: StoreRollup = { risk: { immediate: 0, medium: 0, low: 0, na: 0 }, roster: 0, non_gm: 0, open_reqs: 0, gm_risk: null, sales: null, target: null };
const RISK_RANK: Record<TeamMember["flight_risk"], number> = { na: 0, low: 1, medium: 2, immediate: 3 };

export function TeamPipelinePage() {
  const [nav, setNav] = useState<Nav>({ level: "company" });
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
        <Breadcrumb nav={nav} district={district} store={store} onGo={setNav} />

        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-medium text-amber-800">
          <Lock className="h-4 w-4 shrink-0" />
          Talent Planning pilot — gated by the <code className="rounded bg-amber-100 px-1 font-mono text-[12px]">team_pipeline</code> flag.
        </div>

        {nav.level === "company" && (
          <Company districts={districts} roll={roll} meta={districtMeta} canWrite={rollupQ.data?.can_write ?? false} onOpen={(id) => setNav({ level: "district", districtId: id })} />
        )}
        {nav.level === "district" && district && (
          <District district={district} onOpen={(sid) => setNav({ level: "store", districtId: district.id, storeId: sid })} />
        )}
        {nav.level === "store" && store && <Store store={store} />}
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
            <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Immediate flight risk</div>
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
                  <span className={cn("font-semibold", t.reqs > 0 ? "text-amber-600" : "text-heading")}>{t.reqs}</span><span className={cn("-ml-3", t.reqs > 0 ? "text-amber-600/80" : "text-ink-muted")}>open</span>
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
      <div className="mb-5 text-sm text-ink-muted">GM Bench · flight risk &amp; succession</div>

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
                  <Th>General Manager</Th><Th>Store</Th><Th>Flight risk</Th><Th>Reason</Th><Th>Aspiration</Th><Th>Latest comment</Th><Th>Identified backfill</Th><Th />
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
        <NineBox roster={roster} />
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
          <span>Team member</span><span>Flight risk</span><span>Aspiration</span><span>Perf</span>
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

// ── 9-box ────────────────────────────────────────────────────────────────────
const NB_COLS = ["Low", "Solid", "Top"];        // performance →
const NB_ROWS = ["High", "Moderate", "Lower"];  // potential ↓ (high at top)
const perfCol = (p: number) => (p >= 4 ? 2 : p === 3 ? 1 : 0);
const potRow = (p: number) => (p >= 4 ? 0 : p === 3 ? 1 : 2);
function cellTone(col: number, row: number): "star" | "good" | "mid" | "watch" {
  if (col === 2 && row === 0) return "star";
  if (col === 0 && row === 2) return "watch";
  if (col + (2 - row) >= 3) return "good";
  return "mid";
}
const TONE_BG: Record<string, string> = {
  star: "bg-emerald-50 border-emerald-200", good: "bg-emerald-50/50 border-emerald-100",
  mid: "bg-surface-muted border-border", watch: "bg-red-50/60 border-red-100",
};
function NineBox({ roster }: { roster: TeamMember[] }) {
  const { open } = useMemberDrawer();
  const rated = roster.filter((m) => m.perf != null && m.potential != null);
  const cellOf = (col: number, row: number) => rated.filter((m) => perfCol(m.perf!) === col && potRow(m.potential!) === row);
  const unrated = roster.length - rated.length;

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="flex gap-2">
        <div className="grid w-5 grid-rows-3">
          {NB_ROWS.map((l) => <div key={l} className="flex items-center justify-center [writing-mode:vertical-rl] rotate-180 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">{l}</div>)}
        </div>
        <div>
          <div className="grid grid-cols-3 gap-2" style={{ gridTemplateRows: "repeat(3, 116px)" }}>
            {NB_ROWS.map((_, row) => NB_COLS.map((_, col) => {
              const people = cellOf(col, row);
              return (
                <div key={`${row}-${col}`} className={cn("flex flex-col gap-1 overflow-hidden rounded-xl border p-2", TONE_BG[cellTone(col, row)])}>
                  <div className="flex flex-wrap content-start gap-1">
                    {people.map((m) => <button key={m.id} onClick={() => open(m)} title={`${m.full_name} · ${LADDER_BY_KEY[m.role]?.abbr}`} className="rounded-full transition hover:ring-2 hover:ring-accent/40"><Avatar name={m.full_name} risk={m.flight_risk} /></button>)}
                  </div>
                </div>
              );
            }))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {NB_COLS.map((l) => <div key={l} className="text-center text-[11px] font-bold uppercase tracking-wide text-ink-subtle">{l}</div>)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm text-ink-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Legend</div>
        <Legend sw="bg-emerald-200" label="Star — top perf + high potential" />
        <Legend sw="bg-emerald-100" label="Strong" />
        <Legend sw="bg-zinc-200" label="Core" />
        <Legend sw="bg-red-100" label="Watch — low perf + lower potential" />
        <div className="mt-2 max-w-[230px] text-xs text-ink-muted">Axes: performance (→) × potential (↓). Avatar ring color = flight risk.{unrated > 0 ? ` ${unrated} not yet rated.` : ""}</div>
      </div>
    </div>
  );
}
function Legend({ sw, label }: { sw: string; label: string }) {
  return <div className="flex items-center gap-2"><span className={cn("h-3.5 w-3.5 rounded", sw)} />{label}</div>;
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
