// Global comms-notification feed for the bell. Polls the aggregated
// unread-message endpoint on the same cadence as the chat unread badge
// so the count stays live anywhere in the app. Shares one query key so
// the bell's dropdown and the badge read from a single fetch.

import { useQuery } from "@tanstack/react-query";
import { fetchNotifications } from "./api";

export function useWoNotifications() {
  return useQuery({
    queryKey: ["wo2", "notifications"],
    queryFn: fetchNotifications,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
