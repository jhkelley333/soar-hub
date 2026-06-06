// Cash Management — viewport router. Desktop keeps the tabbed hub (with the
// page padding the AppShell normally provides, since this route is full-bleed);
// mobile gets the native-feeling MobileCashApp shell with its own bottom nav.

import { useIsDesktop } from "@/lib/useMediaQuery";
import { CashManagementHubPage } from "./CashManagementHubPage";
import { MobileCashApp } from "./MobileCashApp";

export function CashManagementRoute() {
  const isDesktop = useIsDesktop();
  if (!isDesktop) return <MobileCashApp />;
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <CashManagementHubPage />
    </div>
  );
}
