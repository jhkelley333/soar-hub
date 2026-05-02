import { PageHeader } from "@/shared/ui/PageHeader";
import { EmptyState } from "@/shared/ui/EmptyState";

export function ResourcesPage() {
  return (
    <>
      <PageHeader
        title="Resource Center"
        description="SOPs, training documents, and key contacts."
      />
      <EmptyState
        title="Module under construction"
        description="Phase 2 will introduce a searchable library of operating procedures, vendor contacts, and training assets, scoped by role."
      />
    </>
  );
}
