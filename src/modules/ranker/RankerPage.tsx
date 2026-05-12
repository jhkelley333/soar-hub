// Ranker — module entry. Toolbar with week + tab-specific selects,
// three-tab UI (Portfolio / Store View / Head-to-Head), state lifted
// here for cross-tab drilldown navigation. Route gating is handled by
// router.tsx (do/sdo/rvp/vp/coo/admin only), so we don't repeat it.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { fetchInit } from "./api";
import { money } from "./format";
import { PortfolioView } from "./PortfolioView";
import { StoreView } from "./StoreView";
import { H2HView } from "./H2HView";
import type { PeerCandidate } from "./types";

type Tab = "portfolio" | "store" | "h2h";

const TABS: { id: Tab; label: string }[] = [
  { id: "portfolio", label: "Portfolio" },
  { id: "store", label: "Store View" },
  { id: "h2h", label: "Head-to-Head" },
];

export function RankerPage() {
  const init = useQuery({
    queryKey: ["ranker", "init"],
    queryFn: fetchInit,
    staleTime: 5 * 60_000,
  });

  const [tab, setTab] = useState<Tab>("portfolio");
  const [week, setWeek] = useState<string>("");
  const [store, setStore] = useState<string>("");
  const [peerStore, setPeerStore] = useState<string>("");
  const [peerCandidates, setPeerCandidates] = useState<PeerCandidate[]>([]);
  const [storeA, setStoreA] = useState<string>("");
  const [storeB, setStoreB] = useState<string>("");

  // Seed defaults once init returns.
  useEffect(() => {
    if (!init.data) return;
    const weeks = init.data.availableWeeks;
    if (weeks.length && !week) {
      const defaultWeek =
        init.data.currentWeek ?? weeks[weeks.length - 1];
      setWeek(String(defaultWeek));
    }
    const stores = init.data.allStores;
    if (stores.length && !store) setStore(stores[0]);
    if (stores.length && !storeA) setStoreA(stores[0]);
    if (stores.length > 1 && !storeB) setStoreB(stores[1]);
  }, [init.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (init.isLoading) {
    return (
      <>
        <PageHeader
          title="Ranker"
          description="Weekly performance across your stores."
        />
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }
  if (init.isError) {
    return (
      <>
        <PageHeader title="Ranker" />
        <EmptyState
          title="Couldn't load Ranker"
          description={(init.error as Error)?.message ?? "Try again."}
        />
      </>
    );
  }
  if (!init.data) return null;

  if (init.data.availableWeeks.length === 0) {
    return (
      <>
        <PageHeader title="Ranker" />
        <EmptyState
          title="No weekly data yet"
          description="Once corporate publishes a week tab in the metrics sheet, it'll show up here."
        />
      </>
    );
  }
  if (init.data.allStores.length === 0) {
    return (
      <>
        <PageHeader title="Ranker" />
        <EmptyState
          title="No stores in your scope"
          description="Ask your admin to assign you to a region, area, or district."
        />
      </>
    );
  }

  function shiftWeek(dir: -1 | 1) {
    const weeks = init.data!.availableWeeks.map(String);
    const i = weeks.indexOf(week);
    if (i === -1) return;
    const next = i + dir;
    if (next >= 0 && next < weeks.length) setWeek(weeks[next]);
  }

  function handleDrillStore(s: string) {
    setStore(s);
    setPeerStore("");
    setTab("store");
  }
  function handleDrillH2H(s: string) {
    setStoreA(s);
    if (!storeB || storeB === s) {
      const other = init.data!.allStores.find((x) => x !== s);
      if (other) setStoreB(other);
    }
    setTab("h2h");
  }

  return (
    <>
      <PageHeader
        title="Ranker"
        description="Weekly performance across your stores."
      />

      {/* Tabs */}
      <div className="mb-4 flex border-b border-zinc-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium tracking-tight transition",
              tab === t.id
                ? "border-accent text-midnight"
                : "border-transparent text-zinc-500 hover:text-midnight",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <Field label="Week">
          <select
            value={week}
            onChange={(e) => setWeek(e.target.value)}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {init.data.availableWeeks.map((w) => (
              <option key={w} value={String(w)}>
                Week {w}
              </option>
            ))}
          </select>
        </Field>

        {tab === "store" && (
          <>
            <Field label="Store">
              <select
                value={store}
                onChange={(e) => {
                  setStore(e.target.value);
                  setPeerStore("");
                }}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {init.data.allStores.map((s) => (
                  <option key={s} value={s}>
                    Store {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Peer">
              <select
                value={peerStore}
                onChange={(e) => setPeerStore(e.target.value)}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Auto-pick peer</option>
                {peerCandidates.map((p) => (
                  <option key={p.store} value={p.store}>
                    {p.store} · {money(p.weeklySales)}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        {tab === "h2h" && (
          <>
            <Field label="Store A">
              <select
                value={storeA}
                onChange={(e) => setStoreA(e.target.value)}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {init.data.allStores.map((s) => (
                  <option key={s} value={s}>
                    Store {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Store B">
              <select
                value={storeB}
                onChange={(e) => setStoreB(e.target.value)}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {init.data.allStores.map((s) => (
                  <option key={s} value={s}>
                    Store {s}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-500 hover:bg-zinc-50 hover:text-midnight"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-500 hover:bg-zinc-50 hover:text-midnight"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </Card>

      {/* Body */}
      {tab === "portfolio" && (
        <PortfolioView
          week={week}
          onDrillStore={handleDrillStore}
          onDrillH2H={handleDrillH2H}
        />
      )}
      {tab === "store" && (
        <StoreView
          week={week}
          store={store}
          peerStore={peerStore}
          onPeerCandidatesLoaded={setPeerCandidates}
        />
      )}
      {tab === "h2h" && <H2HView week={week} storeA={storeA} storeB={storeB} />}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}
