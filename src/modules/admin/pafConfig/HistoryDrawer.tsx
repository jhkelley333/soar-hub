import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { fetchPafConfigHistory, restorePafConfig } from "./api";

export function HistoryDrawer({
  open,
  onClose,
  onRestored,
  currentVersion,
}: {
  open: boolean;
  onClose: () => void;
  onRestored: () => void;
  currentVersion: number;
}) {
  const toast = useToast();
  const [restoring, setRestoring] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ["paf-config-history"],
    queryFn: () => fetchPafConfigHistory(10),
    enabled: open,
  });

  const restoreMut = useMutation({
    mutationFn: restorePafConfig,
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function onRestore(version: number) {
    if (
      !window.confirm(
        `Restore version ${version}? This creates a new version copying its contents — nothing is destroyed.`
      )
    ) {
      return;
    }
    setRestoring(version);
    try {
      await restoreMut.mutateAsync(version);
      toast.push(`Restored from v${version}.`, "success");
      onClose();
      onRestored();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Restore failed.", "error");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-zinc-900/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl"
        role="dialog"
        aria-label="Configuration history"
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-midnight">
              Version history
            </h2>
            <p className="text-xs text-zinc-500">
              Last 10 saved versions. Restoring creates a new version.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {query.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          )}
          {query.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {(query.error as Error)?.message ?? "Couldn't load history."}
            </div>
          )}
          {query.data && query.data.entries.length === 0 && (
            <div className="text-sm text-zinc-500">No history yet.</div>
          )}
          {query.data && query.data.entries.length > 0 && (
            <ul className="space-y-2">
              {query.data.entries.map((e) => {
                const isCurrent = e.config_version === currentVersion;
                return (
                  <li
                    key={e.id}
                    className="rounded-md border border-zinc-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-mono text-xs text-zinc-500">
                          v{e.config_version}
                          {isCurrent && (
                            <span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 ring-1 ring-green-200">
                              current
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium text-midnight">
                          {e.change_summary || "(no summary)"}
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-500">
                          {e.updated_by} ·{" "}
                          {new Date(e.updated_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                      {!isCurrent && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onRestore(e.config_version)}
                          disabled={restoring !== null}
                        >
                          {restoring === e.config_version
                            ? "Restoring…"
                            : "Restore"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
