// Team Pipeline — Talent Planning. Foundation scaffold: a scoped Company →
// District → Store drill-down built on the viewer's real org tree (fetchMyTree,
// RLS-scoped). The talent overlays — GM bench / flight risk, the four store
// layouts (bench ladder, roster, 9-box, staffing planner), hiring reqs, and
// corrective-action documents — land in subsequent slices on top of this shell.
//
// Gated behind the `team_pipeline` feature flag (see router + nav).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Lock, Users } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchMyTree } from "@/modules/my-stores/api";
import type { MyDistrictNode, MyStoreNode } from "@/modules/my-stores/types";

type Nav =
  | { level: "company" }
  | { level: "district"; districtId: string }
  | { level: "store"; districtId: string; storeId: string };

export function TeamPipelinePage() {
  const [nav, setNav] = useState<Nav>({ level: "company" });
  const treeQ = useQuery({ queryKey: ["my-tree"], queryFn: fetchMyTree, staleTime: 5 * 60_000 });

  // Flatten the scoped tree to the districts (and their stores) the viewer can see.
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

  const totalStores = districts.reduce((n, d) => n + d.stores.length, 0);

  return (
    <div className="mx-auto max-w-[1100px]">
      <Breadcrumb nav={nav} district={district} store={store} onGo={setNav} />

      {/* Pilot notice */}
      <div className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] font-medium text-amber-800">
        <Lock className="h-4 w-4 shrink-0" />
        Talent Planning pilot — gated by the <code className="rounded bg-amber-100 px-1 font-mono text-[12px]">team_pipeline</code> flag. Succession, staffing, hiring &amp; corrective-action documents are building out in slices.
      </div>

      {nav.level === "company" && (
        <Company districts={districts} totalStores={totalStores} onOpen={(id) => setNav({ level: "district", districtId: id })} />
      )}
      {nav.level === "district" && district && (
        <District district={district} onOpen={(sid) => setNav({ level: "store", districtId: district.id, storeId: sid })} />
      )}
      {nav.level === "store" && store && <Store store={store} />}
    </div>
  );
}

function Breadcrumb({ nav, district, store, onGo }: { nav: Nav; district: MyDistrictNode | null; store: MyStoreNode | null; onGo: (n: Nav) => void }) {
  const crumb = "text-sm font-semibold text-accent hover:underline";
  return (
    <div className="mb-4 flex items-center gap-2 text-sm">
      {nav.level === "company" ? (
        <span className="font-semibold text-heading">All districts</span>
      ) : (
        <button className={crumb} onClick={() => onGo({ level: "company" })}>All districts</button>
      )}
      {district && (
        <>
          <ChevronRight className="h-4 w-4 text-ink-subtle" />
          {nav.level === "district" ? (
            <span className="font-semibold text-heading">{district.name || "District"}</span>
          ) : (
            <button className={crumb} onClick={() => onGo({ level: "district", districtId: district.id })}>{district.name || "District"}</button>
          )}
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

function Company({ districts, totalStores, onOpen }: { districts: MyDistrictNode[]; totalStores: number; onOpen: (id: string) => void }) {
  return (
    <>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Team Pipeline</div>
      <h1 className="mb-5 text-2xl font-bold tracking-tight text-heading">Talent Planning</h1>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Districts" value={districts.length} />
        <Kpi label="Stores" value={totalStores} />
        <Kpi label="GM seats at risk" value="—" hint="next slice" />
        <Kpi label="Open requisitions" value="—" hint="next slice" />
      </div>

      <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Districts</div>
      {districts.length === 0 ? (
        <EmptyState title="No districts in your scope" description="Talent Planning shows the districts and stores you oversee." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {districts.map((d) => (
            <button key={d.id} onClick={() => onOpen(d.id)}
              className="group rounded-2xl border border-border bg-surface p-5 text-left shadow-card transition hover:border-accent/60 hover:shadow-float">
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent"><Building2 className="h-5 w-5" strokeWidth={1.75} /></span>
                <ChevronRight className="h-4 w-4 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-accent" />
              </div>
              <div className="mt-4 text-base font-semibold tracking-tight text-heading">{d.name || "District"}</div>
              <div className="mt-1 text-sm text-ink-muted">{d.stores.length} store{d.stores.length === 1 ? "" : "s"}</div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function District({ district, onOpen }: { district: MyDistrictNode; onOpen: (storeId: string) => void }) {
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-heading">{district.name || "District"}</h1>
      <div className="mb-5 text-sm text-ink-muted">{district.stores.length} store{district.stores.length === 1 ? "" : "s"} · GM bench &amp; flight-risk view coming in the next slice</div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {district.stores.map((s) => (
          <button key={s.id} onClick={() => onOpen(s.id)}
            className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition hover:border-accent/60">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-[12px] font-bold text-accent">#{s.number}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-heading">{s.name || `Store #${s.number}`}</div>
              <div className="text-xs text-ink-muted">{s.soar_company_name || "—"}</div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300 transition group-hover:text-accent" />
          </button>
        ))}
      </div>
    </>
  );
}

function Store({ store }: { store: MyStoreNode }) {
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-heading">{store.name || `Store #${store.number}`}</h1>
      <div className="mb-6 text-sm text-ink-muted">Store #{store.number}</div>
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface-muted px-6 py-14 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-accent"><Users className="h-6 w-6" /></span>
        <div className="text-base font-semibold text-heading">Team &amp; talent planning lands here</div>
        <p className="max-w-md text-sm text-ink-muted">
          The next slices add this store's roster with the four layouts — bench ladder, roster table, 9-box grid, and the staffing planner — plus per-person succession, flight risk, and corrective-action documents.
        </p>
      </div>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="text-2xl font-bold tabular-nums leading-none text-heading">{value}</div>
      <div className="mt-1.5 text-xs text-ink-muted">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">{hint}</div>}
    </div>
  );
}
