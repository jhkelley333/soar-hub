import { useState } from "react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { cn } from "@/lib/cn";
import { ListTab } from "./tabs/ListTab";
import { VendorsTab } from "./tabs/VendorsTab";
import { VideosTab } from "./tabs/VideosTab";
import { StaticTab } from "./tabs/StaticTab";
import { SOLUGENIX, COKE, RF_TECH } from "./tabs/staticContent";

type TabKey =
  | "list"
  | "vendors"
  | "videos"
  | "solugenix"
  | "coke"
  | "rftech";

const TABS: { key: TabKey; label: string }[] = [
  { key: "list", label: "Work orders" },
  { key: "vendors", label: "Vendors" },
  { key: "videos", label: "Videos" },
  { key: "solugenix", label: "Solugenix" },
  { key: "coke", label: "Coke" },
  { key: "rftech", label: "RF Tech" },
];

export function WorkOrdersPage() {
  const [tab, setTab] = useState<TabKey>("list");

  return (
    <>
      <PageHeader
        title="Work Orders"
        description="Facility issues, equipment repairs, vendor dispatches, and reference info."
        actions={
          <a
            href="https://app.smartsheet.com/b/form/a2d7a96141784059801f6d81b90110e6"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-cherry px-4 py-2 text-sm font-medium text-white transition hover:bg-cherry-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frost focus-visible:ring-offset-2"
          >
            📝 Submit Work Order
          </a>
        }
      />

      <div className="mb-6 border-b border-zinc-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Work order tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
                tab === t.key
                  ? "border-accent text-accent"
                  : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-midnight"
              )}
              aria-current={tab === t.key ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "list" && <ListTab />}
      {tab === "vendors" && <VendorsTab />}
      {tab === "videos" && <VideosTab />}
      {tab === "solugenix" && <StaticTab content={SOLUGENIX} />}
      {tab === "coke" && <StaticTab content={COKE} />}
      {tab === "rftech" && <StaticTab content={RF_TECH} />}
    </>
  );
}
