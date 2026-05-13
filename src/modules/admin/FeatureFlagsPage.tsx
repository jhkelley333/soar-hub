// Admin-only feature flags editor.
//
// Purpose: a place to flip Phase-1 rollout flags (and any future ones)
// without SQL access. Lists every row in `feature_flags`, lets an
// admin toggle `enabled`, edit allowlists, and create / delete keys.
//
// Permission: route gated to role=admin in router.tsx. Backend also
// re-checks role for every write action; UI hiding is not the only
// guard.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
  upsertFeatureFlag,
  type FeatureFlagRow,
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
  const [stores, setStores] = useState(flag.allowlist_stores.join(", "));
  const [userIds, setUserIds] = useState(flag.allowlist_user_ids.join(", "));
  const [notes, setNotes] = useState(flag.notes || "");

  const save = useMutation({
    mutationFn: () =>
      upsertFeatureFlag({
        key: flag.key,
        enabled,
        allowlist_stores: stores
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        allowlist_user_ids: userIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
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
          <Label htmlFor={`stores-${flag.key}`}>Pilot stores (comma-separated store numbers)</Label>
          <Input
            id={`stores-${flag.key}`}
            value={stores}
            onChange={(e) => setStores(e.target.value)}
            placeholder="1242, 2167"
          />
        </div>
        <div>
          <Label htmlFor={`users-${flag.key}`}>Pilot users (comma-separated profile UUIDs)</Label>
          <Input
            id={`users-${flag.key}`}
            value={userIds}
            onChange={(e) => setUserIds(e.target.value)}
            placeholder="aaaa-bbbb-…, cccc-dddd-…"
          />
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
