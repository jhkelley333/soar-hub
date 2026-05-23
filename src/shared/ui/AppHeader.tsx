// Per-screen sticky header — sits inside the content area, beneath the
// AppShell's app-level chrome. Title on the left, optional leading
// (typically a back button), optional trailing (typically a search /
// more icon + a StatusPill). White surface with a hairline divider so it
// reads as part of the content stack, not part of the app nav.

import { cn } from "@/lib/cn";

export function AppHeader({
  title,
  subtitle,
  leading,
  trailing,
  sticky = true,
  divide = true,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  sticky?: boolean;
  divide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        sticky && "sticky top-0 z-20",
        "bg-white",
        divide && "border-b border-midnight-100",
        className,
      )}
    >
      <div className="flex items-center gap-3 px-4 h-12">
        {leading}
        <div className="flex-1 min-w-0">
          <div className="text-[17px] leading-tight font-semibold text-midnight-900 truncate">
            {title}
          </div>
          {subtitle && (
            <div className="text-[11.5px] text-midnight-500 truncate">{subtitle}</div>
          )}
        </div>
        {trailing}
      </div>
    </div>
  );
}
