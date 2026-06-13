// Team Pipeline — Talent Planning. A scoped Company → District → Store
// drill-down on the viewer's RLS-scoped org tree (fetchMyTree), overlaid with
// talent roll-ups (flight risk, roster size, open reqs) from team-pipeline.js.
// The richer store layouts (bench ladder, 9-box, staffing planner) and the
// GM bench / corrective-action documents build out in later slices.
//
// Gated behind the `team_pipeline` feature flag (see router + nav).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronRight, Lock, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { fetchMyTree } from "@/modules/my-stores/api";
import type { MyDistrictNode, MyStoreNode } from "@/modules/my-stores/types";
import { fetchGms, fetchRollup, fetchStoreRoster, seedFromProfiles } from "./api";
import {
  ASPIRATION_META, LADDER, LADDER_BY_KEY, RISK_META,
  type RollupResponse, type StoreRollup, type TeamMember,
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
    <div className="mx-auto max-w-[1100px]">
      <Breadcrumb nav={nav} district={district} store={store} onGo={setNav} />

      <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-medium text-amber-800">
        <Lock className="h-4 w-4 shrink-0" />
        Talent Planning pilot — gated by the <code className="rounded bg-amber-100 px-1 font-mono text-[12px]">team_pipeline</code> flag. The GM bench, store layouts &amp; corrective-action documents are building out in slices.
      </div>

      {nav.level === "company" && (
        <Company districts={districts} roll={roll} onOpen={(id) => setNav({ level: "district", districtId: id })} />
      )}
      {nav.level === "district" && district && (
        <District district={district} onOpen={(sid) => setNav({ level: "store", districtId: district.id, storeId: sid })} />
      )}
      {nav.level === "store" && store && <Store store={store} />}
    </div>
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
function Company({ districts, roll, onOpen }: { districts: MyDistrictNode[]; roll: RollupResponse["stores"]; onOpen: (id: string) => void }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const allStores = districts.flatMap((d) => d.stores);
  const totals = sumRisk(allStores, roll);

  const seed = useMutation({
    mutationFn: seedFromProfiles,
    onSuccess: (r) => { toast.push(`Seeded ${r.created} team member${r.created === 1 ? "" : "s"} from profiles.`, "success"); qc.invalidateQueries({ queryKey: ["tp-rollup"] }); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't seed.", "error"),
  });

  return (
    <>
      <div className="mb-1 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Team Pipeline</div>
          <h1 className="text-2xl font-bold tracking-tight text-heading">Talent Planning</h1>
        </div>
        {profile?.role === "admin" && (
          <Button size="sm" variant="secondary" disabled={seed.isPending} onClick={() => seed.mutate()}>
            {seed.isPending ? "Seeding…" : "Seed from profiles"}
          </Button>
        )}
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
  const needsPlan = gm && (gm.flight_risk === "immediate" || gm.flight_risk === "medium") && !(gm.backfill ?? "").trim();
  return (
    <tr className="cursor-pointer transition hover:bg-surface-muted" onClick={onOpen}>
      <td className="border-b border-border px-3 py-3">
        {gm ? (
          <div className="flex items-center gap-2.5">
            <Avatar name={gm.full_name} risk={gm.flight_risk} />
            <div className="min-w-0">
              <div className="truncate font-semibold text-heading">{gm.full_name}</div>
              {gm.phone && <div className="text-xs text-ink-muted">{gm.phone}</div>}
            </div>
          </div>
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

// ── Store (roster) ──────────────────────────────────────────────────────────
function Store({ store }: { store: MyStoreNode }) {
  const rosterQ = useQuery({ queryKey: ["tp-store-roster", store.id], queryFn: () => fetchStoreRoster(store.id) });
  const roster = rosterQ.data?.roster ?? [];
  const order = Object.fromEntries(LADDER.map((r, i) => [r.key, i]));
  const sorted = [...roster].sort((a, b) => (order[b.role] - order[a.role]) || a.full_name.localeCompare(b.full_name));

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-heading">{store.name || `Store #${store.number}`}</h1>
      <div className="mb-5 text-sm text-ink-muted">Store #{store.number} · {roster.length} team member{roster.length === 1 ? "" : "s"}</div>

      {rosterQ.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : roster.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface-muted px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-accent"><Users className="h-6 w-6" /></span>
          <div className="text-base font-semibold text-heading">No team members yet</div>
          <p className="max-w-md text-sm text-ink-muted">This store's roster is empty. It will fill from the ATS import (or the admin "Seed from profiles" action). The bench ladder, 9-box, and staffing planner layouts build on this in the next slices.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="grid grid-cols-[1.6fr_1fr_1fr_0.8fr] gap-3 border-b border-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">
            <span>Team member</span><span>Flight risk</span><span>Aspiration</span><span>Perf</span>
          </div>
          {sorted.map((m) => <RosterRow key={m.id} m={m} />)}
        </div>
      )}
    </>
  );
}

function RosterRow({ m }: { m: TeamMember }) {
  const risk = RISK_META[m.flight_risk];
  const asp = ASPIRATION_META[m.aspiration];
  return (
    <div className="grid grid-cols-[1.6fr_1fr_1fr_0.8fr] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
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
