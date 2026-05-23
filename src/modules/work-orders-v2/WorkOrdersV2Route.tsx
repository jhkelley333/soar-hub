// Renders the right Work Orders surface for the viewport:
//   lg+   → the full desktop WorkOrdersV2Page (tabs, tables, settings)
//   < lg  → the mobile-first MobileWorkOrders (list + detail)
//
// We branch in JS (useIsDesktop) rather than CSS hidden/block so the
// heavy desktop page never mounts — and never fires its fetches — on a
// phone. The mobile page reuses the same fetchTickets() data layer, so
// nothing is duplicated beyond the presentation.

import { useIsDesktop } from "@/lib/useMediaQuery";
import { WorkOrdersV2Page } from "./WorkOrdersV2Page";
import { MobileWorkOrders } from "./mobile/MobileWorkOrders";

export function WorkOrdersV2Route() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <WorkOrdersV2Page /> : <MobileWorkOrders />;
}
