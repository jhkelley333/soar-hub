import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useAuth } from "@/auth/AuthProvider";

export function PafPage() {
  const { profile } = useAuth();
  const isPayroll = profile?.role === "payroll";

  return (
    <>
      <PageHeader
        title="Payroll Action Forms"
        description={
          isPayroll
            ? "Process new hires, status changes, and terminations across all stores."
            : "Submit and track PAFs for your team."
        }
        actions={isPayroll ? undefined : <Button>New PAF</Button>}
      />
      <EmptyState
        title="Module under construction"
        description={
          isPayroll
            ? "Phase 2 will give payroll a queue of submitted PAFs across the organization with approval and processing actions."
            : "Phase 2 will let managers submit PAFs that route to payroll for processing."
        }
      />
    </>
  );
}
