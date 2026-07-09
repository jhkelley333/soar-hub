// Dashboard — manage the "Actions Needed" checklist that shows on each
// store's Command Center day sheet. GM and above: GMs get their store, DO+
// their scope, admin all stores. Lives next to the message board because
// that's already where leaders talk down to the store screens.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/shared/ui/Toaster";
import {
  deleteLeaderAction, fetchActionStores, fetchLeaderActions, saveLeaderAction,
} from "@/modules/store-portal/api";

const FIELD = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none";

export function StoreActionsManager({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const storesQ = useQuery({ queryKey: ["portal-action-stores"], queryFn: fetchActionStores });
  const stores = useMemo(() => storesQ.data?.stores ?? [], [storesQ.data]);
  const [storeId, setStoreId] = useState<string>("");
  const pickedRef = useRef(false);
  useEffect(() => {
    if (!pickedRef.current && !storeId && stores.length > 0) setStoreId(stores[0].id);
  }, [stores, storeId]);

  const actionsQ = useQuery({
    queryKey: ["portal-actions", storeId],
    queryFn: () => fetchLeaderActions(storeId),
    enabled: !!storeId,
  });
  const actions = actionsQ.data?.actions ?? [];

  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["portal-actions", storeId] });
    qc.invalidateQueries({ queryKey: ["store-portal-live"] });
  };
  const err = (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error");
  const add = useMutation({
    mutationFn: () => saveLeaderAction({ store_id: storeId, title: title.trim(), due_label: due.trim() || undefined, assignee: assignee.trim() || undefined }),
    onSuccess: () => { setTitle(""); setDue(""); setAssignee(""); invalidate(); },
    onError: err,
  });
  const remove = useMutation({ mutationFn: deleteLeaderAction, onSuccess: invalidate, onError: err });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-bold text-heading">Store screen actions</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-subtle transition hover:bg-surface-sunk"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-[13px] text-ink-muted">
          The checklist under "Actions Needed" on the store's Command Center. The floor checks items off; you see it here live.
        </p>

        <select value={storeId} onChange={(e) => { pickedRef.current = true; setStoreId(e.target.value); }}
          className={cn(FIELD, "mb-4 w-full")}>
          {stores.length === 0 && <option value="">No stores in your scope</option>}
          {stores.map((s) => (
            <option key={s.id} value={s.id}>#{s.number}{s.name ? ` · ${s.name}` : ""}</option>
          ))}
        </select>

        {actionsQ.isLoading && storeId ? (
          <p className="py-6 text-center text-[13px] text-ink-subtle">Loading…</p>
        ) : actions.length === 0 ? (
          <p className="rounded-xl bg-surface-muted px-4 py-5 text-center text-sm text-ink-subtle">No action items yet — add the first one below.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {actions.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-3.5 py-3">
                <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                  a.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-border bg-surface")}>
                  {a.done && <Check className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm font-semibold leading-snug", a.done ? "text-ink-subtle line-through" : "text-heading")}>{a.title}</div>
                  <div className="mt-0.5 text-xs text-ink-subtle">
                    {[a.due_label && `Due ${a.due_label}`, a.assignee,
                      a.done && a.done_at && `done ${new Date(a.done_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <button onClick={() => remove.mutate(a.id)} title="Delete"
                  className="rounded-md p-1.5 text-ink-subtle transition hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 rounded-xl border border-border bg-surface-muted p-3">
          <div className="mb-1.5 text-[11px] font-semibold text-ink-muted">New action item</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Count LTO cup inventory before rush"
            className={cn(FIELD, "w-full")} />
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="Due — e.g. 10:00a" className={FIELD} />
            <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Who — e.g. Shift lead" className={FIELD} />
          </div>
          <button disabled={!title.trim() || !storeId || add.isPending} onClick={() => add.mutate()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> {add.isPending ? "Adding…" : "Add item"}
          </button>
        </div>
      </div>
    </div>
  );
}
