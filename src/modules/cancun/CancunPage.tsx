// Route wrapper for the Cancun Convention app — incubated under System Settings
// → Beta Test. Admin-only for now.
import { PageHeader } from "@/shared/ui/PageHeader";
import { CancunApp } from "./CancunApp";

export function CancunPage() {
  return (
    <>
      <PageHeader
        title="Cancun Convention 2026"
        description="CMG Companies convention app — Beta. Attendee guide, checklist, dining, agenda, gated leadership support. Persistence and offline land in follow-up work."
      />
      <CancunApp />
    </>
  );
}
