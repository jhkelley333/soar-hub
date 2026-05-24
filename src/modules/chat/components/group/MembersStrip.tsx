// Chat — horizontal members strip for a group thread: avatars with
// presence dots + first-name labels.

import { CURRENT_USER_ID, USERS } from "../../sampleData";

export function MembersStrip({ memberIds }: { memberIds: string[] }) {
  return (
    <div className="flex shrink-0 gap-3 overflow-x-auto border-b border-midnight-100 bg-surface px-4 py-2.5">
      {memberIds.map((id) => {
        const u = USERS[id];
        if (!u) return null;
        return (
          <div key={id} className="flex w-12 shrink-0 flex-col items-center gap-1">
            <span className="relative">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-frost-100 text-[11px] font-semibold text-midnight-700">
                {u.initials}
              </span>
              {u.online && (
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-ok" />
              )}
            </span>
            <span className="truncate text-[10px] text-midnight-500">
              {id === CURRENT_USER_ID ? "You" : u.first}
            </span>
          </div>
        );
      })}
    </div>
  );
}
