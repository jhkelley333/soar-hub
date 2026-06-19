import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
      <div className="text-sm font-semibold tracking-tight text-heading">{title}</div>
      {description && (
        <div className="mt-1 max-w-sm text-sm text-ink-muted">{description}</div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
