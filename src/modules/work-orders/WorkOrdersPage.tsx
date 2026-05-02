import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";

export function WorkOrdersPage() {
  return (
    <>
      <PageHeader
        title="Work Orders"
        description="Facility issues, equipment repairs, and vendor dispatches."
        actions={<Button>New work order</Button>}
      />
      <EmptyState
        title="Module under construction"
        description="Phase 2 will introduce the work order lifecycle: submission, triage, vendor dispatch, completion, and cost tracking."
      />
    </>
  );
}
