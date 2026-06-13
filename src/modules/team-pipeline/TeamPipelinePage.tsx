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
import { fetchRollup, fetchStoreRoster, seedFromProfiles } from "./api";
import {
  ASPIRATION_META, LADDER, LADDER_BY_KEY, RISK_META,
  type RollupResponse, type StoreRollup, type TeamMember,
} from "./types";

type Nav =
  | { level: "company" }
  | { level: "district"; districtId: string }
  | { level: "store"; districtId: string; storeId: string };

const ZERO: StoreRollup = { risk: { immediate: 0, medium: 0, low: 0, na: 0 }, roster: 0, open_reqs: 0, gm_risk: null };

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
        <District district={district} roll={roll} onOpen={(sid) => setNav({ level: "store", districtId: district.id, storeId: sid })} />
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

// ── District ────────────────────────────────────────────────────────────────
function District({ district, roll, onOpen }: { district: MyDistrictNode; roll: RollupResponse["stores"]; onOpen: (storeId: string) => void }) {
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-heading">{district.name || "District"}</h1>
      <div className="mb-5 text-sm text-ink-muted">{district.stores.length} store{district.stores.length === 1 ? "" : "s"} · GM bench &amp; flight-risk view coming next slice</div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {district.stores.map((s) => {
          const r = roll[s.id] ?? ZERO;
          return (
            <button key={s.id} onClick={() => onOpen(s.id)}
              className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition hover:border-accent/60">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-[12px] font-bold text-accent">#{s.number}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-heading">{s.name || `Store #${s.number}`}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
                  <span>{r.roster} on team</span>
                  {r.risk.immediate > 0 && <span className="font-semibold text-red-600">{r.risk.immediate} immediate</span>}
                  {r.risk.medium > 0 && <span className="font-semibold text-amber-600">{r.risk.medium} medium</span>}
                  {r.open_reqs > 0 && <span className="font-semibold text-accent">{r.open_reqs} open</span>}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300 transition group-hover:text-accent" />
            </button>
          );
        })}
      </div>
    </>
  );
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
