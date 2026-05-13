// Issue Library admin tab — admin-only CRUD over the typeahead seed
// list. The whole /admin/work-orders-v2 route is admin-only, so we
// don't double-gate; the backend `saveIssueItem` / `deleteIssueItem`
// already enforce the role check.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { deleteIssueItem, fetchIssueLibrary, saveIssueItem } from "./api";
import type { IssueLibraryItem } from "./types";

const CATEGORIES = [
  "Facilities & Infrastructure",
  "Equipment Type",
  "POS & POPS",
  "Beverage",
  "Other",
];

export function IssueLibraryTab() {
  const toast = useToast();
  const qc = useQueryClient();

  const libraryQ = useQuery({
    queryKey: ["wo2", "issueLibrary"],
    queryFn: fetchIssueLibrary,
    staleTime: 60_000,
  });

  const [editing, setEditing] = useState<IssueLibraryItem | "new" | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => deleteIssueItem(id),
    onSuccess: () => {
      toast.push("Deleted.", "success");
      qc.invalidateQueries({ queryKey: ["wo2", "issueLibrary"] });
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Delete failed.", "error"),
  });

  const items = libraryQ.data?.items ?? [];
  const grouped = useMemo(() => {
    const map = new Map<string, IssueLibraryItem[]>();
    for (const i of items) {
      const arr = map.get(i.category) ?? [];
      arr.push(i);
      map.set(i.category, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Issue Library Manager
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
          Add Item
        </Button>
      </div>

      {libraryQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {libraryQ.isError && (
        <EmptyState
          title="Couldn't load issue library"
          description={(libraryQ.error as Error)?.message ?? "Try again."}
        />
      )}
      {!libraryQ.isLoading && items.length === 0 && (
        <EmptyState
          title="No items"
          description="Add the first issue type so the new-ticket typeahead has something to show."
        />
      )}

      <div className="space-y-4">
        {grouped.map(([category, list]) => (
          <Card key={category}>
            <div className="border-b border-zinc-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              {category}
            </div>
            <CardBody className="!p-0">
              <ul className="divide-y divide-zinc-100">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 px-4 py-2.5"
                  >
                    <span className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                      {item.asset_type}
                    </span>
                    <span className="flex-1 text-sm text-midnight">{item.display_name}</span>
                    <span className="text-xs text-zinc-400">order {item.sort_order}</span>
                    <button
                      type="button"
                      onClick={() => setEditing(item)}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:border-accent hover:text-midnight"
                    >
                      <Pencil className="h-3 w-3" strokeWidth={1.75} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete "${item.display_name}"?`)) {
                          del.mutate(item.id);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:border-red-300"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>

      {editing !== null && (
        <IssueEditModal
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.push("Saved.", "success");
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["wo2", "issueLibrary"] });
          }}
          onError={(e) => toast.push(e, "error")}
        />
      )}
    </>
  );
}

function IssueEditModal({
  item,
  onClose,
  onSaved,
  onError,
}: {
  item: IssueLibraryItem | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [category, setCategory] = useState(item?.category || CATEGORIES[0]);
  const [assetType, setAssetType] = useState(item?.asset_type || "");
  const [displayName, setDisplayName] = useState(item?.display_name || "");
  const [sortOrder, setSortOrder] = useState(String(item?.sort_order ?? 0));
  const [tips, setTips] = useState(item?.troubleshooting_tips || "");

  const mut = useMutation({
    mutationFn: () => {
      if (!category) return Promise.reject(new Error("Category is required."));
      if (!assetType.trim()) return Promise.reject(new Error("Asset type is required."));
      if (!displayName.trim()) return Promise.reject(new Error("Display name is required."));
      return saveIssueItem({
        id: item?.id,
        category,
        asset_type: assetType.trim(),
        display_name: displayName.trim(),
        sort_order: Number(sortOrder) || 0,
        troubleshooting_tips: tips.trim() ? tips.trim() : null,
      });
    },
    onSuccess: onSaved,
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Save failed."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">
            {item ? "Edit Issue" : "Add Issue"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="il-cat">Category *</Label>
            <select
              id="il-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="il-asset">Asset Type *</Label>
            <Input
              id="il-asset"
              value={assetType}
              onChange={(e) => setAssetType(e.target.value)}
              placeholder="e.g. Ice Machine, HVAC, Roof"
            />
          </div>
          <div>
            <Label htmlFor="il-name">Display Name *</Label>
            <Input
              id="il-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Ice Machine (Left)"
            />
          </div>
          <div>
            <Label htmlFor="il-sort">Sort Order</Label>
            <Input
              id="il-sort"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="il-tips">Troubleshooting Tips</Label>
            <textarea
              id="il-tips"
              value={tips}
              onChange={(e) => setTips(e.target.value)}
              rows={5}
              placeholder={"One tip per line. Shown on the New Service Request modal when this issue is picked.\n\nExample:\n• Check the breaker.\n• Confirm oil level is in range."}
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="mt-1 text-[10px] text-zinc-400">
              Leave blank to use the generic fallback for this category.
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
