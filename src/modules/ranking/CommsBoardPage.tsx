// Standalone Comms Board — the store's weekly communication board, reachable by
// EVERY role (crew → leadership), scoped to the caller's store(s) by the
// ranking-admin `comms-board` read (open to all active users). Leadership also
// reach the same board as a tab inside the Ranker; this page is the universal
// entry so hourly/store staff can see it without the rest of the Ranker.

import { PageHeader } from "@/shared/ui/PageHeader";
import { RankingCommsBoardView } from "./RankingCommsBoardView";

export function CommsBoardPage() {
  return (
    <>
      <PageHeader title="Comms Board" description="Your store's weekly communication board." />
      <RankingCommsBoardView />
    </>
  );
}
