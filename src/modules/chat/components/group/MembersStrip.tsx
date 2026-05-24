// Chat — horizontal members strip for a group thread.

export interface StripMember {
  id: string;
  first: string;
  initials: string;
  online?: boolean;
  isYou?: boolean;
}

export function MembersStrip({ members }: { members: StripMember[] }) {
  return (
    <div className="flex shrink-0 gap-3 overflow-x-auto border-b border-midnight-100 bg-surface px-4 py-2.5">
      {members.map((m) => (
        <div key={m.id} className="flex w-12 shrink-0 flex-col items-center gap-1">
          <span className="relative">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-frost-100 text-[11px] font-semibold text-midnight-700">
              {m.initials}
            </span>
            {m.online && (
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-ok" />
            )}
          </span>
          <span className="truncate text-[10px] text-midnight-500">
            {m.isYou ? "You" : m.first}
          </span>
        </div>
      ))}
    </div>
  );
}
