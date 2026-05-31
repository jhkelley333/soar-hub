// /labor — entry point. The view depends on role:
//   • GM / shift manager → their store's GM view ("Yesterday's labor").
//   • DO and up → the district rollup, with a toggle to drill into a
//     single store's GM view.
// Both views are scope-enforced server-side; this only picks the default.

import { useState } from "react";
import { Segmented } from "@/shared/ui/Segmented";
import { useAuth } from "@/auth/AuthProvider";
import { GmLaborView } from "./GmLaborView";
import { DistrictLaborView } from "./DistrictLaborView";

const ROLLUP_ROLES = ["do", "sdo", "rvp", "vp", "coo", "admin"];

type View = "district" | "store";

export function LaborPage() {
  const { profile } = useAuth();
  const canRollup = ROLLUP_ROLES.includes(profile?.role ?? "");
  const [view, setView] = useState<View>("district");

  if (!canRollup) {
    // GM / shift manager: single-store GM view only.
    return <GmLaborView />;
  }

  return (
    <>
      <div className="mb-4">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "district", label: "District" },
            { value: "store", label: "By store" },
          ]}
        />
      </div>
      {view === "district" ? <DistrictLaborView /> : <GmLaborView />}
    </>
  );
}
