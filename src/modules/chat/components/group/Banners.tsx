// Chat — group thread banners: external-participant warning (cherry) and
// pinned message.

import { Pin, ShieldAlert } from "lucide-react";

export function ExternalBanner({ orgName }: { orgName?: string }) {
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-sonic-50 bg-sonic-50 px-4 py-2.5 text-[12px] text-sonic-700">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
      <p>
        This thread includes external participants
        {orgName ? ` from ${orgName}` : ""}. Don't share confidential ops data.
      </p>
    </div>
  );
}

export function PinnedBanner({ text }: { text: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-midnight-100 bg-surface px-4 py-2 text-[12.5px] text-midnight-700">
      <Pin className="h-3.5 w-3.5 shrink-0 text-midnight-400" strokeWidth={2} />
      <span className="truncate">{text}</span>
    </div>
  );
}
