// Team Pipeline — Talent Planning. A scoped Company → District → Store
// drill-down on the viewer's RLS-scoped org tree (fetchMyTree), overlaid with
// talent roll-ups (flight risk, roster size, open reqs) from team-pipeline.js.
// The richer store layouts (bench ladder, 9-box, staffing planner) and the
// GM bench / corrective-action documents build out in later slices.
//
// Gated behind the `team_pipeline` feature flag (see router + nav).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronRight, Lock, Upload, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Segmented } from "@/shared/ui/Segmented";
import { useToast } from "@/shared/ui/Toaster";
import { fetchMyTree } from "@/modules/my-stores/api";
import type { MyDistrictNode, MyStoreNode } from "@/modules/my-stores/types";
import { fetchGms, fetchRollup, fetchStoreRoster, seedFromProfiles, commitPlan, updateReq } from "./api";
import { MemberDrawerProvider, useMemberDrawer } from "./MemberDrawer";
import { RosterImport } from "./RosterImport";
import {
  ASPIRATION_META, DEFAULT_TIER, LADDER, LADDER_BY_KEY, REQ_STATUS_META, RISK_META, TIERS, roleBelow,
  type LadderKey, type Requisition, type RollupResponse, type StoreRollup, type TeamMember,
} from "./types";

type Nav =
  | { level: "company" }
  | { level: "district"; districtId: string }
  | { level: "store"; districtId: string; storeId: string };

const ZERO: StoreRollup = { risk: { immediate: 0, medium: 0, low: 0, na: 0 }, roster: 0, open_reqs: 0, gm_risk: null };
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

  const district = districts.find((d) => d.id === (nav as { districtId?: string }).districtId) ?? null;
  const store = district?.stores.find((s) => s.id === (nav as { storeId?: string }).storeId) ?? null;

  if (treeQ.isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (treeQ.isError) {
    return <EmptyState title="Couldn't load your org" description={(treeQ.error as Error)?.message ?? "Try again in a moment."} />;
  }

  return (
    <MemberDrawerProvider canWrite={rollupQ.data?.can_write ?? false}>
      <div className="mx-auto max-w-[1100px]">
        <Breadcrumb nav={nav} district={district} store={store} onGo={setNav} />

        <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-medium text-amber-800">
          <Lock className="h-4 w-4 shrink-0" />
          Talent Planning pilot — gated by the <code className="rounded bg-amber-100 px-1 font-mono text-[12px]">team_pipeline</code> flag. The GM bench, store layouts &amp; corrective-action documents are building out in slices.
        </div>

        {nav.level === "company" && (
          <Company districts={districts} roll={roll} canWrite={rollupQ.data?.can_write ?? false} onOpen={(id) => setNav({ level: "district", districtId: id })} />
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
  let immediate = 0, medium = 0, reqs = 0, roster = 0, gmRisk = 0;
  for (const s of stores) {
    const r = roll[s.id] ?? ZERO;
    immediate += r.risk.immediate; medium += r.risk.medium; reqs += r.open_reqs; roster += r.roster;
    if (r.gm_risk === "immediate" || r.gm_risk === "medium") gmRisk += 1;
  }
  return { immediate, medium, reqs, roster, gmRisk };
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
function Company({ districts, roll, canWrite, onOpen }: { districts: MyDistrictNode[]; roll: RollupResponse["stores"]; canWrite: boolean; onOpen: (id: string) => void }) {
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
      <div className="mb-1 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Team Pipeline</div>
          <h1 className="text-2xl font-bold tracking-tight text-heading">Talent Planning</h1>
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

      <div className="my-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Districts" value={districts.length} />
        <Kpi label="Stores" value={allStores.length} />
        <Kpi label="GM seats at risk" value={totals.gmRisk} tone={totals.gmRisk ? "red" : undefined} />
        <Kpi label="Open requisitions" value={totals.reqs} />
      </div>

      <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Districts</div>
      {districts.length === 0 ? (
        <EmptyState title="No districts in your scope" description="Talent Planning shows the districts and stores you oversee." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {districts.map((d) => {
            const t = sumRisk(d.stores, roll);
            return (
              <button key={d.id} onClick={() => onOpen(d.id)}
                className="group rounded-2xl border border-border bg-surface p-5 text-left shadow-card transition hover:border-accent/60 hover:shadow-float">
                <div className="flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent"><Building2 className="h-5 w-5" strokeWidth={1.75} /></span>
                  <ChevronRight className="h-4 w-4 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-accent" />
                </div>
                <div className="mt-4 text-base font-semibold tracking-tight text-heading">{d.name || "District"}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
                  <span>{d.stores.length} store{d.stores.length === 1 ? "" : "s"}</span>
                  {t.immediate > 0 && <span className="font-semibold text-red-600">{t.immediate} immediate</span>}
                  {t.reqs > 0 && <span className="font-semibold text-amber-600">{t.reqs} open req{t.reqs === 1 ? "" : "s"}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
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
  const reqs = rosterQ.data?.reqs ?? [];
  const canWrite = rosterQ.data?.can_write ?? false;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-heading">{store.name || `Store #${store.number}`}</h1>
          <div className="text-sm text-ink-muted">Store #{store.number} · {roster.length} team member{roster.length === 1 ? "" : "s"}</div>
        </div>
        <Segmented<Layout>
          options={[{ value: "ladder", label: "Bench ladder" }, { value: "roster", label: "Roster" }, { value: "ninebox", label: "9-box" }, { value: "plan", label: "Staffing plan" }]}
          value={layout} onChange={setLayout} />
      </div>

      {reqs.length > 0 && <ReqsPanel storeId={store.id} reqs={reqs} canWrite={canWrite} />}

      {rosterQ.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : layout === "plan" ? (
        <StaffingPlanner storeId={store.id} roster={roster} />
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
    </>
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
function StaffingPlanner({ storeId, roster }: { storeId: string; roster: TeamMember[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tier = DEFAULT_TIER; // placeholder until a real per-store tier source exists
  const rec = TIERS[tier].rec;

  const [targets, setTargets] = useState<Partial<Record<LadderKey, number>>>({});
  const [hires, setHires] = useState<Record<string, number>>({});
  const [promos, setPromos] = useState<Promo[]>([]);
  const [holds, setHolds] = useState<Record<string, boolean>>({});
  const [adjust, setAdjust] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState<LadderKey | null>(null);

  const active = roster.filter((m) => m.status !== "loa");
  const have = (k: LadderKey) => active.filter((m) => m.role === k).length;
  const target = (k: LadderKey) => targets[k] ?? rec[k];
  const promoIn = (k: LadderKey) => promos.filter((p) => p.toRole === k).length;
  const promoOut = (k: LadderKey) => promos.filter((p) => p.member.role === k).length;
  const projected = (k: LadderKey) => have(k) + (hires[k] || 0) + promoIn(k) - promoOut(k);
  const stateOf = (k: LadderKey): "short" | "ok" | "over" | "hold" => {
    if (holds[k]) return "hold";
    const g = projected(k) - target(k);
    return g < 0 ? "short" : g > 0 ? "over" : "ok";
  };

  const rolesTopDown = [...LADDER].reverse();
  const openNow = LADDER.reduce((n, r) => n + Math.max(0, rec[r.key] - have(r.key)), 0);
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
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12.5px] font-medium text-amber-800">
        Tier &amp; headcount targets are placeholders ({TIERS[tier].label} · {TIERS[tier].vol}). Swap in the real per-store tier + matrix later.
      </div>

      {/* summary */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
        <div>
          <div className="text-sm font-bold text-heading">{TIERS[tier].label} · model target {LADDER.reduce((n, r) => n + rec[r.key], 0)}</div>
          <div className="text-xs text-ink-muted">{active.length} on staff today</div>
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
        <div className="truncate text-sm font-semibold text-heading">{m.full_name}{m.status === "loa" && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-500">LOA</span>}</div>
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
