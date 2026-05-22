// Pre-Con section that lives at the top of the Checklist tab. Two cards:
//
//   1. Store Attributes — stall data + trailer stall. Reads from
//      stores.* and saves back via the reno-scoping netlify function
//      (stores writes are admin-only at the RLS layer, but the function
//      gates by scope ownership).
//
//   2. Damaged Order Ahead signs — count + free-text notes. Patches the
//      reno_scopes row directly (RLS allows scoper-on-draft or DO+).
//
// Both sections save on blur for inputs / change for the checkbox; a
// small status pill in each card surfaces sync state.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, Check, Loader2 } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Skeleton } from "@/shared/ui/Skeleton";
import { cn } from "@/lib/cn";
import {
  fetchStoreStallAttributes,
  updateScopeDamage,
  updateScopeStoreAttributes,
} from "./api";
import type { RenoScope, StoreStallAttributes } from "./types";

interface Props {
  scope: RenoScope & { store_id: string };
  canEdit: boolean;
}

const ATTRIBUTE_QUERY_KEY = (storeId: string) => ["store-stall-attributes", storeId];

export function PreConSection({ scope, canEdit }: Props) {
  return (
    <div className="space-y-4">
      <StoreAttributesCard scope={scope} canEdit={canEdit} />
      <DamagedSignsCard scope={scope} canEdit={canEdit} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Store Attributes
// ----------------------------------------------------------------------------

function StoreAttributesCard({ scope, canEdit }: Props) {
  const queryClient = useQueryClient();
  const attrsQuery = useQuery({
    queryKey: ATTRIBUTE_QUERY_KEY(scope.store_id),
    queryFn: () => fetchStoreStallAttributes(scope.store_id),
    staleTime: 30_000,
  });

  // Local form mirror so each input can be edited freely before blur.
  const [draft, setDraft] = useState<StoreStallAttributes | null>(null);
  useEffect(() => {
    if (attrsQuery.data) setDraft(attrsQuery.data);
  }, [attrsQuery.data]);

  const mutation = useMutation({
    mutationFn: (patch: Partial<StoreStallAttributes>) =>
      updateScopeStoreAttributes(scope.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTRIBUTE_QUERY_KEY(scope.store_id) });
    },
  });

  function patch<K extends keyof StoreStallAttributes>(key: K, value: StoreStallAttributes[K]) {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
  }

  function commit(key: keyof StoreStallAttributes) {
    if (!draft || !attrsQuery.data) return;
    if (draft[key] === attrsQuery.data[key]) return;
    mutation.mutate({ [key]: draft[key] } as Partial<StoreStallAttributes>);
  }

  if (attrsQuery.isLoading || !draft) {
    return (
      <Card>
        <div className="p-4">
          <Skeleton className="h-32 w-full" />
        </div>
      </Card>
    );
  }
  if (attrsQuery.isError) {
    return (
      <Card>
        <div className="flex items-start gap-2 p-3 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>
            Couldn't load store attributes:{" "}
            {(attrsQuery.error as Error)?.message ?? "Unknown error"}
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-3 p-4">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-zinc-500" strokeWidth={2} />
            <h3 className="text-sm font-semibold text-midnight">Store attributes</h3>
          </div>
          <SaveStatus
            saving={mutation.isPending}
            saved={mutation.isSuccess}
            error={mutation.isError ? (mutation.error as Error)?.message : null}
          />
        </header>
        <p className="text-xs text-zinc-500">
          Captured at the scope visit. Saves back to the canonical store record.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <NumField
            id="patio-pop-count"
            label="# Patio POP menus"
            value={draft.patio_pop_menu_count}
            disabled={!canEdit}
            onChange={(v) => patch("patio_pop_menu_count", v)}
            onBlur={() => commit("patio_pop_menu_count")}
          />
          <TextField
            id="patio-pop-stalls"
            label="Patio POP stall #s"
            placeholder="e.g. 1,2,3,4"
            value={draft.patio_pop_stall_numbers ?? ""}
            disabled={!canEdit}
            onChange={(v) => patch("patio_pop_stall_numbers", v || null)}
            onBlur={() => commit("patio_pop_stall_numbers")}
          />
          <NumField
            id="oa-stall-count"
            label="# Order Ahead stalls"
            value={draft.order_ahead_stall_count}
            disabled={!canEdit}
            onChange={(v) => patch("order_ahead_stall_count", v)}
            onBlur={() => commit("order_ahead_stall_count")}
          />
          <TextField
            id="oa-stalls"
            label="Order Ahead stall #s"
            placeholder="e.g. 5,6"
            value={draft.order_ahead_stall_numbers ?? ""}
            disabled={!canEdit}
            onChange={(v) => patch("order_ahead_stall_numbers", v || null)}
            onBlur={() => commit("order_ahead_stall_numbers")}
          />
          <NumField
            id="stall-pop-count"
            label="# Stall POP menus"
            value={draft.stall_pop_menu_count}
            disabled={!canEdit}
            onChange={(v) => patch("stall_pop_menu_count", v)}
            onBlur={() => commit("stall_pop_menu_count")}
          />
          <div className="space-y-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-200">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.has_trailer_stall}
                disabled={!canEdit}
                onChange={(e) => {
                  patch("has_trailer_stall", e.target.checked);
                  // Boolean is committed immediately rather than waiting
                  // for a blur — checkboxes are atomic.
                  mutation.mutate({ has_trailer_stall: e.target.checked });
                  if (!e.target.checked) {
                    patch("trailer_stall_number", null);
                    mutation.mutate({ trailer_stall_number: null });
                  }
                }}
              />
              <span className="text-zinc-700">Trailer stall</span>
            </label>
            {draft.has_trailer_stall && (
              <TextField
                id="trailer-stall-number"
                label="Trailer stall #"
                placeholder="e.g. 12"
                value={draft.trailer_stall_number ?? ""}
                disabled={!canEdit}
                onChange={(v) => patch("trailer_stall_number", v || null)}
                onBlur={() => commit("trailer_stall_number")}
              />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Damaged OA signs
// ----------------------------------------------------------------------------

function DamagedSignsCard({ scope, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [count, setCount] = useState<number>(scope.damaged_oa_signs_count ?? 0);
  const [notes, setNotes] = useState<string>(scope.damaged_oa_signs_notes ?? "");

  useEffect(() => {
    setCount(scope.damaged_oa_signs_count ?? 0);
    setNotes(scope.damaged_oa_signs_notes ?? "");
  }, [scope.damaged_oa_signs_count, scope.damaged_oa_signs_notes]);

  const mutation = useMutation({
    mutationFn: (patch: { damaged_oa_signs_count?: number; damaged_oa_signs_notes?: string | null }) =>
      updateScopeDamage(scope.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reno-scope", scope.id] });
    },
  });

  function commitCount() {
    if (count === (scope.damaged_oa_signs_count ?? 0)) return;
    mutation.mutate({ damaged_oa_signs_count: count });
  }

  function commitNotes() {
    const next = notes.trim() || null;
    const prev = scope.damaged_oa_signs_notes ?? null;
    if (next === prev) return;
    mutation.mutate({ damaged_oa_signs_notes: next });
  }

  return (
    <Card>
      <div className="space-y-3 p-4">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" strokeWidth={2} />
            <h3 className="text-sm font-semibold text-midnight">Damaged Order Ahead signs</h3>
          </div>
          <SaveStatus
            saving={mutation.isPending}
            saved={mutation.isSuccess}
            error={mutation.isError ? (mutation.error as Error)?.message : null}
          />
        </header>
        <p className="text-xs text-zinc-500">
          Number of damaged OA signs on site (drives the replacement order). Notes for context.
        </p>

        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
          <NumField
            id="damaged-oa-count"
            label="# Damaged"
            value={count}
            disabled={!canEdit}
            onChange={setCount}
            onBlur={commitCount}
          />
          <div>
            <Label htmlFor="damaged-oa-notes">Notes</Label>
            <textarea
              id="damaged-oa-notes"
              rows={3}
              value={notes}
              disabled={!canEdit}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={commitNotes}
              placeholder="e.g. Stalls 3 and 7 — faded; #5 has a cracked face."
              className="w-full resize-none rounded-md border-0 bg-zinc-50 px-3 py-2 text-sm text-midnight ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-frost disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Field helpers
// ----------------------------------------------------------------------------

function NumField({
  id,
  label,
  value,
  disabled,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
        }}
        onBlur={onBlur}
      />
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}

function SaveStatus({
  saving,
  saved,
  error,
}: {
  saving: boolean;
  saved: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-700">
        <AlertTriangle className="h-3 w-3" strokeWidth={2} />
        {error}
      </span>
    );
  }
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
        <Loader2 className={cn("h-3 w-3 animate-spin")} strokeWidth={2} />
        Saving…
      </span>
    );
  }
  if (saved) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
        <Check className="h-3 w-3" strokeWidth={2} />
        Saved
      </span>
    );
  }
  return null;
}
