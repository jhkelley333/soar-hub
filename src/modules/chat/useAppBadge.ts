// Mirrors the live unread-chat total onto the installed-PWA app-icon badge.
// Mount once, app-wide (AppShell), so the icon stays accurate everywhere —
// not just on the chat screens. Clears the badge on unmount (logout / app
// teardown).

import { useEffect } from "react";
import { useChatUnreadCount } from "./useChatUnread";
import { applyAppBadge } from "@/lib/appBadge";

export function useAppBadge(): void {
  const count = useChatUnreadCount();

  useEffect(() => {
    applyAppBadge(count);
  }, [count]);

  useEffect(() => {
    return () => applyAppBadge(0);
  }, []);
}
