// COO Command Center — one page for the COO, so the day-to-day modules can
// come off his sidebar. Every section reuses the live module behind it
// (Ranker, Labor, P&L, PAF, Business Disruptions, Employee Actions); only the
// KPI board, PAF response queue, disruption rollup and settings are new.
// The active section lives in ?tab= so a section can be bookmarked or linked.

import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Archive, BarChart3, CalendarRange, FileSpreadsheet, Gauge, GraduationCap,
  LayoutDashboard, Receipt, Settings, Trophy, type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { EmptyState } from "@/shared/ui/EmptyState";
import { cn } from "@/lib/cn";
import { RankingResultsView } from "@/modules/ranking/RankingResultsView";
import { LaborV2Entry } from "@/modules/labor-v2/LaborV2Entry";
import { PlPage } from "@/modules/pl/PlPage";
import { PafArchivePage } from "@/modules/paf/PafArchivePage";
import { BusinessDisruptionsPage } from "@/modules/business-disruptions/BusinessDisruptionsPage";
import { PtoReportPanel } from "@/modules/employee-actions/PtoReportPanel";
import { CreditBankPanel } from "@/modules/employee-actions/CreditBankPanel";
import { KpiBoard } from "./KpiBoard";
import { PafResponses } from "./PafResponses";
import { useCooPafQueue } from "./useCooPafQueue";
import { DisruptionSummary } from "./DisruptionSummary";
import { CooSettings } from "./CooSettings";
import { SectionBoundary } from "./SectionBoundary";

type TabId =
  | "kpi" | "ranker" | "labor" | "pl"
  | "paf" | "paf-archive"
  | "disruptions" | "pto" | "training" | "credits"
  | "settings";

interface TabDef { id: TabId; label: string; icon: LucideIcon; blurb: string }

const GROUPS: { label: string; tabs: TabDef[] }[] = [
  {
    label: "Performance",
    tabs: [
      { id: "kpi", label: "KPI Board", icon: LayoutDashboard, blurb: "Company performance from the latest Ranker run. Click an RVP to drill to SDO, DO and store." },
      { id: "ranker", label: "Ranker", icon: Trophy, blurb: "The full company ranking, same board the field sees." },
      { id: "labor", label: "Labor", icon: Gauge, blurb: "Daily labor review from the KPI feed." },
      { id: "pl", label: "P&L", icon: BarChart3, blurb: "Store income statements by period." },
    ],
  },
  {
    label: "PAF",
    tabs: [
      { id: "paf", label: "Waiting on me", icon: FileSpreadsheet, blurb: "PAFs that need your approval. Open one to read the full form, then approve or reject." },
      { id: "paf-archive", label: "PAF Archive", icon: Archive, blurb: "Every PAF on record, searchable. Read-only." },
    ],
  },
  {
    label: "Reporting",
    tabs: [
      { id: "disruptions", label: "Business Disruptions", icon: AlertTriangle, blurb: "Closures and disruptions reported by GMs." },
      { id: "pto", label: "PTO", icon: CalendarRange, blurb: "PTO taken and requested, by employee and store." },
      { id: "training", label: "Training Credits", icon: GraduationCap, blurb: "Each store's training credit budget, used and remaining." },
      { id: "credits", label: "Other Credits", icon: Receipt, blurb: "Other credits stores apply for." },
    ],
  },
  {
    label: "You",
    tabs: [{ id: "settings", label: "My Settings", icon: Settings, blurb: "Choose what shows in your sidebar." }],
  },
];
const ALL_TABS = GROUPS.flatMap((g) => g.tabs);

export function CooCommandCenterPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as TabId | null;
  const tab: TabId = ALL_TABS.some((t) => t.id === raw) ? (raw as TabId) : "kpi";
  const def = ALL_TABS.find((t) => t.id === tab)!;
  const go = (id: TabId) => { setParams(id === "kpi" ? {} : { tab: id }); window.scrollTo(0, 0); };

  const pafQ = useCooPafQueue();
  const badge = (id: TabId) => (id === "paf" && pafQ.mineCount > 0 ? pafQ.mineCount : null);

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <PageHeader title="Command Center" description="Everything you run the company on, in one place." className="mb-5" />

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Section rail: a column on desktop, a scrolling row on phones. */}
        <nav aria-label="Command Center sections" className="lg:w-56 lg:shrink-0">
          <div className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:mx-0 lg:block lg:space-y-4 lg:overflow-visible">
            {GROUPS.map((g) => (
              <div key={g.label} className="flex gap-1 lg:block lg:space-y-0.5">
                <div className="hidden px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle lg:block">{g.label}</div>
                {g.tabs.map((t) => {
                  const b = badge(t.id);
                  return (
                    <button key={t.id} onClick={() => go(t.id)} aria-current={t.id === tab ? "page" : undefined}
                      className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition lg:w-full",
                        t.id === tab ? "bg-accent text-accent-fg" : "text-ink-2 hover:bg-surface-muted")}>
                      <t.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      <span className="flex-1 text-left">{t.label}</span>
                      {b !== null && (
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                          t.id === tab ? "bg-white/20 text-white" : "bg-cherry text-white")}>{b}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        <section className="min-w-0 flex-1">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-heading">{def.label}</h2>
            <p className="text-sm text-ink-muted">{def.blurb}</p>
          </div>
          <SectionBoundary key={tab}>
            <Section tab={tab} pafPending={pafQ.mineCount} onOpenPaf={() => go("paf")} />
          </SectionBoundary>
        </section>
      </div>
    </div>
  );
}

function Section({ tab, pafPending, onOpenPaf }: { tab: TabId; pafPending: number; onOpenPaf: () => void }): ReactNode {
  switch (tab) {
    case "kpi": return <KpiBoard pendingPafs={pafPending} onOpenPaf={onOpenPaf} />;
    case "ranker": return <RankingResultsView viewScope="company" />;
    case "labor": return <LaborV2Entry />;
    case "pl": return <PlPage />;
    case "paf": return <PafResponses />;
    case "paf-archive": return <PafArchivePage />;
    case "disruptions": return <div className="space-y-6"><DisruptionSummary /><BusinessDisruptionsPage /></div>;
    case "pto": return <PtoReportPanel />;
    case "training": return <CreditBankPanel />;
    case "credits":
      return (
        <EmptyState
          title="Not tracked in the Hub yet"
          description="Training credits are the only store credit the Hub records today. Once the other credit types have a request form, their report lands here."
        />
      );
    case "settings": return <CooSettings />;
  }
}
