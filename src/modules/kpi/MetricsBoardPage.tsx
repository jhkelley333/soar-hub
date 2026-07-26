// /admin/metrics-board — the Execution Metrics Board (scope-selectable wall
// display). Lives on its own route while the old /admin/kpi drilldown stays up.
import { MetricsBoard } from "./board/MetricsBoard";

export function MetricsBoardPage() {
  return (
    <div className="p-4 sm:p-6">
      <MetricsBoard />
    </div>
  );
}
