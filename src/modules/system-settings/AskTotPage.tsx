import { PageHeader } from "@/shared/ui/PageHeader";
import { RankingAskTotView } from "@/modules/ranking/RankingAskTotView";

export function AskTotPage() {
  return (
    <>
      <PageHeader
        title="Ask Ninja Tot"
        description="AI assistant for SOAR Hub — ask about stores, ranking, labor, drive-through KPI, policies, and more."
      />
      <RankingAskTotView />
    </>
  );
}
