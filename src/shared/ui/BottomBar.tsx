// Sticky action bar pinned to the bottom of a screen for one-handed
// reach. Translucent white background + backdrop blur so list content
// stays partially visible underneath, with a hairline ring on top and
// an iOS safe-area inset on bottom so it sits above the home indicator.

import { cn } from "@/lib/cn";

export function BottomBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur ring-1 ring-midnight-100 shadow-bar px-4 pt-3 pb-5",
        className,
      )}
      style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {children}
    </div>
  );
}
