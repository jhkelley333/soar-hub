// Total unread chat messages for the signed-in user — powers the nav
// badge. Shares the ["chat","inbox"] query key with the inbox page, so
// realtime invalidation and reads stay in sync without a second fetch.

import { useQuery } from "@tanstack/react-query";
import { fetchInbox } from "./api";

export function useChatUnreadCount(): number {
  const q = useQuery({
    queryKey: ["chat", "inbox"],
    queryFn: fetchInbox,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const threads = q.data?.threads ?? [];
  return threads.reduce((sum, t) => sum + (t.unreadCount || 0), 0);
}
