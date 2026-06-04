// Walkthrough review — DO dashboard. Two tabs: the submissions inbox and the
// corrective-actions tracker. Scoped to the caller's stores by RLS.

import { useState } from "react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { cn } from "@/lib/cn";
import { SubmissionsTab } from "./SubmissionsTab";
import { CorrectiveActionsTab } from "./CorrectiveActionsTab";

type TabId = "submissions" | "capa";
const TABS: { id: TabId; label: string }[] = [
  { id: "submissions", label: "Submissions" },
  { id: "capa", label: "Corrective actions" },
];

export function ReviewDashboardPage() {
  const [tab, setTab] = useState<TabId>("submissions");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Walkthrough review"
        description="Review submitted walkthroughs and track corrective actions across your stores."
      />

      <div className="mb-5 flex gap-1 border-b border-zinc-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition",
              tab === t.id
                ? "border-accent text-midnight"
                : "border-transparent text-zinc-500 hover:text-zinc-700",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "submissions" ? <SubmissionsTab /> : <CorrectiveActionsTab />}
    </div>
  );
}
