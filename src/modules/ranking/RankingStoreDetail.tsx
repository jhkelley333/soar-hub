// The store-detail view for the NEW ranker — it reuses the legacy Ranker's
// StoreView (hero, momentum, execution-score ring, guest signals, and the
// 4W/8W/12W KPI scorecard with sparklines and vs-LW deltas) plus a Week / Store
// / Peer toolbar. The legacy backend (ranker.js) is JWT + is_active scoped via
// user_visible_stores, so every role — GMs included — gets exactly their
// stores, and its week list runs from P1W1 through the latest published week,
// which is how history all the way back becomes browsable here.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fiscalWeekLabel } from "@/lib/fiscal";
import { fetchInit } from "@/modules/ranker/api";
import { money } from "@/modules/ranker/format";
import { StoreView } from "@/modules/ranker/StoreView";
import type { PeerCandidate } from "@/modules/ranker/types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      {children}
    </div>
  );
}

const selectCls =
  "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export function RankingStoreDetail({ store, showStorePicker = false }: { store?: string; showStorePicker?: boolean }) {
  const init = useQuery({ queryKey: ["ranker", "init"], queryFn: fetchInit, staleTime: 5 * 60_000 });
  const [week, setWeek] = useState("");
  const [sel, setSel] = useState(store ?? "");
  const [peer, setPeer] = useState("");
  const [peerCandidates, setPeerCandidates] = useState<PeerCandidate[]>([]);

  // Seed the week (latest) and store (the clicked one, else first in scope).
  useEffect(() => {
    if (!init.data) return;
    const weeks = init.data.availableWeeks;
    if (weeks.length && !week) setWeek(String(init.data.currentWeek ?? weeks[weeks.length - 1]));
    if (!sel) {
      const s = store && init.data.allStores.includes(store) ? store : init.data.allStores[0];
      if (s) setSel(s);
    }
  }, [init.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the row the caller clicked into.
  useEffect(() => { if (store) { setSel(store); setPeer(""); } }, [store]);

  if (init.isLoading) return <Skeleton className="h-96 w-full" />;
  if (init.isError) return <EmptyState title="Couldn't load" description={(init.error as Error)?.message ?? "Try again."} />;
  if (!init.data || !init.data.availableWeeks.length) {
    return <EmptyState title="No weekly data yet" description="Once a week is published in the metrics sheet it'll show up here." />;
  }
  if (!init.data.allStores.length) {
    return <EmptyState title="No stores in your scope" description="Ask your admin to assign you to a store, district, area, or region." />;
  }

  const weeks = init.data.availableWeeks.map(String);
  const shiftWeek = (dir: -1 | 1) => {
    const i = weeks.indexOf(week);
    const n = i + dir;
    if (n >= 0 && n < weeks.length) setWeek(weeks[n]);
  };

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <Field label="Week">
          <select value={week} onChange={(e) => setWeek(e.target.value)} className={selectCls}>
            {init.data.availableWeeks.map((w) => (
              <option key={w} value={String(w)}>{fiscalWeekLabel(Number(w)) || `Week ${w}`}</option>
            ))}
          </select>
        </Field>
        {showStorePicker && init.data.allStores.length > 1 && (
          <Field label="Store">
            <select value={sel} onChange={(e) => { setSel(e.target.value); setPeer(""); }} className={selectCls}>
              {init.data.allStores.map((s) => <option key={s} value={s}>Store {s}</option>)}
            </select>
          </Field>
        )}
        <Field label="Peer">
          <select value={peer} onChange={(e) => setPeer(e.target.value)} className={selectCls}>
            <option value="">Auto-pick peer</option>
            {peerCandidates.map((p) => <option key={p.store} value={p.store}>{p.store} · {money(p.weeklySales)}</option>)}
          </select>
        </Field>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => shiftWeek(-1)} aria-label="Previous week"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-500 hover:bg-zinc-50 hover:text-midnight">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button type="button" onClick={() => shiftWeek(1)} aria-label="Next week"
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-500 hover:bg-zinc-50 hover:text-midnight">
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </Card>

      {sel && <StoreView week={week} store={sel} peerStore={peer} onPeerCandidatesLoaded={setPeerCandidates} />}
    </div>
  );
}

// The GM's landing — the same detail, defaulting to their own store with a
// picker if they happen to run more than one.
export function MyStoreView() {
  return <RankingStoreDetail showStorePicker />;
}
