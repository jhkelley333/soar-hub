import { PageHeader } from "@/shared/ui/PageHeader";
import { EmptyState } from "@/shared/ui/EmptyState";

export function RankerPage() {
  return (
    <>
      <PageHeader
        title="Ranker"
        description="Performance dashboards across stores, districts, and areas."
      />
      <EmptyState
        title="Module under construction"
        description="Phase 3 will deliver leaderboards and performance trends sourced from sales, labor, and operational KPIs."
      />
    </>
  );
}
