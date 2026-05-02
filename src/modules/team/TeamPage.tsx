import { PageHeader } from "@/shared/ui/PageHeader";
import { EmptyState } from "@/shared/ui/EmptyState";

export function TeamPage() {
  return (
    <>
      <PageHeader
        title="My Team"
        description="People you manage and how to reach them."
      />
      <EmptyState
        title="Module under construction"
        description="Phase 2 will surface your direct reports, store rosters, and contact information based on your scope."
      />
    </>
  );
}
