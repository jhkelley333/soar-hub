// Troubleshooting Tips tab — admin-only.
//
// A flatter, faster way to author per-issue "things to check first"
// prompts than the Issue Library edit modal. Lists every row in
// issue_library grouped by category with an inline textarea bound
// to `troubleshooting_tips`. Each row has its own Save button that
// lights up when the text is dirty.
//
// Reuses the existing saveIssueItem action — the backend just
// spreads whatever fields land in the payload, so we send the row's
// other identifiers unchanged and only the tips actually change.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { fetchIssueLibrary, saveIssueItem } from "./api";
import type { IssueLibraryItem } from "./types";

export function TroubleshootingTipsTab() {
  const toast = useToast();
  const qc = useQueryClient();

  const libraryQ = useQuery({
    queryKey: ["wo2", "issueLibrary"],
    queryFn: fetchIssueLibrary,
    staleTime: 60_000,
  });

  // Local edit buffer — id -> current textarea value. Initialized from
  // the server response, updated as the user types, reconciled back
  // when a save succeeds.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Seed drafts from server data the first time it arrives, plus any
  // newly-arrived rows after a refetch. Don't overwrite in-flight edits.
  useEffect(() => {
    const items = libraryQ.data?.items;
    if (!items) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (!(item.id in next)) {
          next[item.id] = item.troubleshooting_tips ?? "";
        }
      }
      return next;
    });
  }, [libraryQ.data]);

  const items = libraryQ.data?.items ?? [];

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      i.display_name.toLowerCase().includes(q) ||
      i.asset_type.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q) ||
      (i.troubleshooting_tips ?? "").toLowerCase().includes(q),
    );
  }, [items, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, IssueLibraryItem[]>();
    for (const i of filtered) {
      const arr = map.get(i.category) ?? [];
      arr.push(i);
      map.set(i.category, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const save = useMutation({
    mutationFn: async (item: IssueLibraryItem) => {
      const value = (drafts[item.id] ?? "").trim();
      setSavingId(item.id);
      try {
        return await saveIssueItem({
          id: item.id,
          category: item.category,
          asset_type: item.asset_type,
          display_name: item.display_name,
          sort_order: item.sort_order,
          troubleshooting_tips: value || null,
        });
      } finally {
        setSavingId(null);
      }
    },
    onSuccess: () => {
      toast.push("Tips saved.", "success");
      qc.invalidateQueries({ queryKey: ["wo2", "issueLibrary"] });
    },
    onError: (e: unknown) => {
      toast.push(e instanceof Error ? e.message : "Save failed.", "error");
    },
  });

  function isDirty(item: IssueLibraryItem) {
    const current = drafts[item.id] ?? "";
    const saved = item.troubleshooting_tips ?? "";
    return current.trim() !== saved.trim();
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs text-zinc-500">
          One line per tip. These appear on the New Service Request modal
          when a user picks this issue. Leave blank to fall back to the
          generic category prompt.
        </div>
        <div className="relative w-64">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            strokeWidth={1.75}
          />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search issues or tips…"
            className="pl-7"
          />
        </div>
      </div>

      {libraryQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {libraryQ.isError && (
        <EmptyState
          title="Couldn't load issue library"
          description={(libraryQ.error as Error)?.message ?? "Try again."}
        />
      )}
      {!libraryQ.isLoading && !libraryQ.isError && filtered.length === 0 && (
        <EmptyState
          title="No issues match"
          description={filter ? "Adjust the search filter above." : "Add issues from the Issue Library tab first."}
        />
      )}

      <div className="space-y-4">
        {grouped.map(([category, list]) => (
          <Card key={category}>
            <CardHeader title={category} description={`${list.length} issue${list.length === 1 ? "" : "s"}`} />
            <CardBody className="divide-y divide-zinc-100 p-0">
              {list.map((item) => {
                const dirty = isDirty(item);
                const busy = savingId === item.id && save.isPending;
                return (
                  <div key={item.id} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[220px_1fr_auto]">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        {item.asset_type}
                      </div>
                      <div className="text-sm font-medium text-midnight">
                        {item.display_name}
                      </div>
                    </div>
                    <textarea
                      value={drafts[item.id] ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      rows={4}
                      placeholder={"One tip per line.\nExample:\n• Check the breaker.\n• Confirm oil level is in range."}
                      className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <div className="flex flex-col items-stretch justify-start gap-1">
                      <Button
                        variant={dirty ? "primary" : "ghost"}
                        onClick={() => save.mutate(item)}
                        disabled={!dirty || busy}
                      >
                        {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                        Save
                      </Button>
                      {dirty && !busy && (
                        <button
                          type="button"
                          onClick={() =>
                            setDrafts((prev) => ({
                              ...prev,
                              [item.id]: item.troubleshooting_tips ?? "",
                            }))
                          }
                          className="text-[10px] text-zinc-500 hover:text-midnight"
                        >
                          Revert
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
