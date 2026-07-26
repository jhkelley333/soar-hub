// /admin/kpi — the KPI Dashboard is now the Execution Metrics Board: a
// scope-selectable (company / region / store) wall display organizing
// performance around six pillars, each with its Metric That Matters and the
// execution metrics that drive it. See src/modules/kpi/board/.
import { MetricsBoard } from "./board/MetricsBoard";

export function KpiDashboardPage() {
  return (
    <div className="p-4 sm:p-6">
      <MetricsBoard />
    </div>
  );
}
