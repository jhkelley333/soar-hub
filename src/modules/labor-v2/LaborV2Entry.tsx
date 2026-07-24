// /labor-v2 — entry point, merged like the legacy /labor tab. The view
// depends on role:
//   • GM / shift manager → their store's GM view ("Yesterday's labor").
//   • DO and up → the Team rollup (District / Market / Region), with a toggle
//     to drill into a single store's GM view.
// Both are scope-enforced server-side; this only picks the default.

import { useState } from "react";
import { Segmented } from "@/shared/ui/Segmented";
import { useAuth } from "@/auth/AuthProvider";
import { LaborV2GmPage } from "./LaborV2GmPage";
import { LaborV2TeamPage } from "./LaborV2TeamPage";
import { NoGmCreditPanel } from "./NoGmCreditPanel";
import { GmSupportCreditPanel } from "./GmSupportCreditPanel";

const ROLLUP_ROLES = ["do", "sdo", "rvp", "vp", "coo", "admin"];
// Who can manage the no-GM weekly labor credit tags.
const NO_GM_ROLES = ["sdo", "rvp", "vp", "coo", "admin"];

type View = "team" | "store" | "no-gm" | "gm-support";

export function LaborV2Entry() {
  const { profile } = useAuth();
  const role = profile?.role ?? "";
  const canRollup = ROLLUP_ROLES.includes(role);
  const canNoGm = NO_GM_ROLES.includes(role);
  const [view, setView] = useState<View>("team");

  if (!canRollup) {
    // GM / shift manager: single-store GM view only.
    return <LaborV2GmPage />;
  }

  return (
    <>
      <div className="mb-4">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "team", label: "Team" },
            { value: "store", label: "By store" },
            ...(canNoGm ? [{ value: "no-gm" as const, label: "No-GM credit" }] : []),
            ...(canNoGm ? [{ value: "gm-support" as const, label: "GM support hrs" }] : []),
          ]}
        />
      </div>
      {view === "team" ? <LaborV2TeamPage />
        : view === "store" ? <LaborV2GmPage />
        : view === "gm-support" ? <GmSupportCreditPanel />
        : <NoGmCreditPanel />}
    </>
  );
}
