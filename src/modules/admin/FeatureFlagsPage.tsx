// Admin-only feature flags editor.
//
// Purpose: a place to flip Phase-1 rollout flags (and any future ones)
// without SQL access. Lists every row in `feature_flags`, lets an
// admin toggle `enabled`, edit allowlists, and create / delete keys.
//
// Permission: route gated to role=admin in router.tsx. Backend also
// re-checks role for every write action; UI hiding is not the only
// guard.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, X, Search } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import {
  deleteFeatureFlag,
  listFeatureFlags,
  searchStoresForFlag,
  searchUsersForFlag,
  upsertFeatureFlag,
  type FeatureFlagRow,
  type ResolvedStore,
  type ResolvedUser,
} from "@/lib/flags";

export function FeatureFlagsPage() {
  const toast = useToast();
  const qc = useQueryClient();

  const flagsQ = useQuery({
    queryKey: ["feature-flags-admin"],
    queryFn: listFeatureFlags,
    staleTime: 30_000,
  });

  const [draft, setDraft] = useState<{ open: boolean; key: string }>({
    open: false,
    key: "",
  });

  const flags = useMemo(() => flagsQ.data?.flags ?? [], [flagsQ.data]);

  return (
    <>
      <PageHeader
        title="Feature Flags"
        description="Toggle gated features for everyone, or pilot-roll via per-store and per-user allowlists."
        actions={
          <Button variant="primary" onClick={() => setDraft({ open: true, key: "" })}>
            <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
            New flag
          </Button>
        }
      />

      {flagsQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {flagsQ.isError && (
        <EmptyState
          title="Couldn't load flags"
          description={(flagsQ.error as Error)?.message ?? "Try again."}
        />
      )}
      {!flagsQ.isLoading && !flagsQ.isError && flags.length === 0 && (
        <EmptyState
          title="No flags defined"
          description="Create one to gate a new feature."
        />
      )}

      <div className="space-y-3">
        {flags.map((f) => (
          <FlagRow
            key={f.key}
            flag={f}
            onSaved={() => qc.invalidateQueries({ queryKey: ["feature-flags-admin"] })}
            onError={(msg) => toast.push(msg, "error")}
            onDeleted={() => {
              qc.invalidateQueries({ queryKey: ["feature-flags-admin"] });
              toast.push("Flag deleted.", "success");
            }}
          />
        ))}
      </div>

      {draft.open && (
        <NewFlagModal
          onClose={() => setDraft({ open: false, key: "" })}
          onCreated={() => {
            setDraft({ open: false, key: "" });
            qc.invalidateQueries({ queryKey: ["feature-flags-admin"] });
            toast.push("Flag created.", "success");
          }}
          onError={(msg) => toast.push(msg, "error")}
        />
      )}
    </>
  );
}

interface FlagRowProps {
  flag: FeatureFlagRow;
  onSaved: () => void;
  onError: (msg: string) => void;
  onDeleted: () => void;
}

function FlagRow({ flag, onSaved, onError, onDeleted }: FlagRowProps) {
  const [enabled, setEnabled] = useState(flag.enabled);
  const [users, setUsers] = useState<ResolvedUser[]>(
    flag.resolved_users && flag.resolved_users.length > 0
      ? flag.resolved_users
      : flag.allowlist_user_ids.map((id) => ({ id, full_name: null, email: null, role: null })),
  );
  const [stores, setStores] = useState<ResolvedStore[]>(
    flag.resolved_stores && flag.resolved_stores.length > 0
      ? flag.resolved_stores
      : flag.allowlist_stores.map((n) => ({ number: n, name: null })),
  );
  const [notes, setNotes] = useState(flag.notes || "");

  const save = useMutation({
    mutationFn: () =>
      upsertFeatureFlag({
        key: flag.key,
        enabled,
        allowlist_stores: stores.map((s) => s.number),
        allowlist_user_ids: users.map((u) => u.id),
        notes: notes.trim() || null,
      }),
    onSuccess: () => onSaved(),
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Save failed."),
  });

  const del = useMutation({
    mutationFn: () => deleteFeatureFlag(flag.key),
    onSuccess: () => onDeleted(),
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Delete failed."),
  });

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2 font-mono text-sm">
            {flag.key}
            {enabled ? (
              <Badge tone="success">ON (everyone)</Badge>
            ) : flag.allowlist_stores.length || flag.allowlist_user_ids.length ? (
              <Badge tone="warning">Pilot allowlist</Badge>
            ) : (
              <Badge tone="neutral">OFF</Badge>
            )}
          </span>
        }
        description={
          flag.updated_at
            ? `Last edited ${new Date(flag.updated_at).toLocaleString()}`
            : undefined
        }
      />
      <CardBody className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Enabled for everyone
        </label>
        <div>
          <Label>Pilot stores</Label>
          <StorePicker selected={stores} onChange={setStores} />
        </div>
        <div>
          <Label>Pilot users</Label>
          <UserPicker selected={users} onChange={setUsers} />
        </div>
        <div>
          <Label htmlFor={`notes-${flag.key}`}>Notes</Label>
          <textarea
            id={`notes-${flag.key}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete flag "${flag.key}"? Any code referencing it will fall back to OFF.`)) {
                del.mutate();
              }
            }}
            disabled={del.isPending}
            className="inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-900"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Delete
          </button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function NewFlagModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [key, setKey] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const trimmed = key.trim();
      if (!trimmed) return Promise.reject(new Error("Key is required."));
      if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) {
        return Promise.reject(
          new Error('Key must be lowercase letters, numbers, and underscores only.'),
        );
      }
      return upsertFeatureFlag({
        key: trimmed,
        enabled: false,
        allowlist_stores: [],
        allowlist_user_ids: [],
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => onCreated(),
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Create failed."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="border-b border-zinc-100 px-5 py-3 text-base font-semibold tracking-tight text-midnight">
          New feature flag
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="new-flag-key">Key</Label>
            <Input
              id="new-flag-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. wo2_my_tickets_view"
              autoComplete="off"
            />
            <div className="mt-1 text-[10px] text-zinc-500">
              Lowercase, snake_case. Referenced from code via useFlag('key').
            </div>
          </div>
          <div>
            <Label htmlFor="new-flag-notes">Notes</Label>
            <textarea
              id="new-flag-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="What this gates and why."
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}

// useDebouncedValue — keystroke-friendly search throttle. 200ms is the
// sweet spot for "feels instant" without hammering the backend.
function useDebouncedValue<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface UserPickerProps {
  selected: ResolvedUser[];
  onChange: (next: ResolvedUser[]) => void;
}

function UserPicker({ selected, onChange }: UserPickerProps) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 200);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results = useQuery({
    queryKey: ["flag-search-users", debounced],
    queryFn: () => searchUsersForFlag(debounced),
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
  });

  const selectedIds = new Set(selected.map((u) => u.id));
  const matches = (results.data?.users || []).filter((u) => !selectedIds.has(u.id));

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        {selected.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-midnight"
          >
            <span className="font-medium">{u.full_name || u.email || u.id}</span>
            {u.role && <span className="text-[10px] uppercase text-zinc-500">{u.role}</span>}
            <button
              type="button"
              onClick={() => onChange(selected.filter((s) => s.id !== u.id))}
              className="rounded-full p-0.5 text-zinc-500 hover:bg-accent/20 hover:text-midnight"
              aria-label={`Remove ${u.full_name || u.email}`}
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <div className="flex flex-1 items-center gap-1 px-1">
          <Search className="h-3.5 w-3.5 text-zinc-400" strokeWidth={1.75} />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={selected.length === 0 ? "Search by name or email…" : "Add another…"}
            className="min-w-[120px] flex-1 bg-transparent text-sm text-midnight placeholder:text-zinc-400 focus:outline-none"
          />
        </div>
      </div>
      {open && debounced.trim().length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg">
          {results.isLoading && (
            <div className="px-3 py-2 text-xs text-zinc-500">Searching…</div>
          )}
          {!results.isLoading && matches.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">No matches.</div>
          )}
          {matches.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                onChange([...selected, u]);
                setQuery("");
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-zinc-50"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-midnight">{u.full_name || "—"}</span>
                <span className="ml-2 text-xs text-zinc-500">{u.email}</span>
              </span>
              {u.role && (
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">{u.role}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface StorePickerProps {
  selected: ResolvedStore[];
  onChange: (next: ResolvedStore[]) => void;
}

function StorePicker({ selected, onChange }: StorePickerProps) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 200);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results = useQuery({
    queryKey: ["flag-search-stores", debounced],
    queryFn: () => searchStoresForFlag(debounced),
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
  });

  const selectedNumbers = new Set(selected.map((s) => s.number));
  const matches = (results.data?.stores || []).filter(
    (s) => !selectedNumbers.has(s.number),
  );

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        {selected.map((s) => (
          <span
            key={s.number}
            className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-midnight"
          >
            <span className="font-medium">#{s.number}</span>
            {s.name && <span className="text-zinc-600">{s.name}</span>}
            <button
              type="button"
              onClick={() => onChange(selected.filter((x) => x.number !== s.number))}
              className="rounded-full p-0.5 text-zinc-500 hover:bg-accent/20 hover:text-midnight"
              aria-label={`Remove store ${s.number}`}
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </span>
        ))}
        <div className="flex flex-1 items-center gap-1 px-1">
          <Search className="h-3.5 w-3.5 text-zinc-400" strokeWidth={1.75} />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={selected.length === 0 ? "Search by store number or name…" : "Add another…"}
            className="min-w-[120px] flex-1 bg-transparent text-sm text-midnight placeholder:text-zinc-400 focus:outline-none"
          />
        </div>
      </div>
      {open && debounced.trim().length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg">
          {results.isLoading && (
            <div className="px-3 py-2 text-xs text-zinc-500">Searching…</div>
          )}
          {!results.isLoading && matches.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">No matches.</div>
          )}
          {matches.map((s) => (
            <button
              key={s.number}
              type="button"
              onClick={() => {
                onChange([...selected, s]);
                setQuery("");
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-50"
            >
              <span className="font-medium text-midnight">#{s.number}</span>
              <span className="text-zinc-600">{s.name || "—"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
