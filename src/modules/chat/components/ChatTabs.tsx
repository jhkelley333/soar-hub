// Chat — All / Direct / Groups / News tab bar with per-tab unread
// counts. Active tab: accent underline + bolder text + filled count.

import { cn } from "@/lib/cn";
import type { ChatTab } from "../types";

const TABS: { id: ChatTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "direct", label: "Direct" },
  { id: "groups", label: "Groups" },
  { id: "news", label: "News" },
];

export function ChatTabs({
  active,
  counts,
  onChange,
}: {
  active: ChatTab;
  counts: Record<ChatTab, number>;
  onChange: (t: ChatTab) => void;
}) {
  return (
    <div className="flex gap-5 border-b border-midnight-100 px-4">
      {TABS.map((t) => {
        const isActive = active === t.id;
        const c = counts[t.id];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "relative -mb-px flex items-center gap-1.5 border-b-2 py-2.5 text-[14px] transition",
              isActive
                ? "border-accent font-semibold text-midnight-900"
                : "border-transparent font-medium text-midnight-400 hover:text-midnight-700",
            )}
          >
            {t.label}
            {c > 0 && (
              <span
                className={cn(
                  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none",
                  isActive
                    ? "bg-midnight-900 text-white"
                    : "bg-midnight-100 text-midnight-600",
                )}
              >
                {c}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
