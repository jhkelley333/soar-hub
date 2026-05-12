// Bulk store attributes — admin-only page for setting / deleting a
// single attribute key across a scope of stores (all, region, area,
// or district). Two-step flow: PREVIEW first (count + sample +
// overwrite-warning), then APPLY behind a typed confirmation.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";

const FN = "/.netlify/functions/org-mgmt";

// ---------- API types ----------

interface OrgTreeStore {
  id: string;
  number: string;
  name: string | null;
}
interface OrgTreeDistrict {
  id: string;
  code: string | null;
  name: string | null;
  stores: OrgTreeStore[];
}
interface OrgTreeArea {
  id: string;
  code: string | null;
  name: string | null;
  districts: OrgTreeDistrict[];
}
interface OrgTreeRegion {
  id: string;
  code: string | null;
  name: string | null;
  areas: OrgTreeArea[];
}
interface OrgTreeResponse {
  regions: OrgTreeRegion[];
  stats: { total_stores: number; active_stores: number };
}

type ScopeType = "all" | "region" | "area" | "district";
type Operation = "set" | "delete";

interface BulkScopeAll { type: "all" }
interface BulkScopeNode { type: "region" | "area" | "district"; id: string }
type BulkScope = BulkScopeAll | BulkScopeNode;

interface PreviewResponse {
  scope_label: string;
  operation: Operation;
  key: string;
  value?: string | number | boolean | null;
  in_scope_count: number;
  already_has_key_count: number;
  will_change_count: number;
  sample_stores: { id: string; number: string; name: string | null }[];
}

interface ApplyResponse {
  bulk_operation_id: string;
  operation: Operation;
  key: string;
  in_scope_count: number;
  updated: number;
  skipped: number;
  errors: { store_id: string | null; number?: string; error: string }[];
}

// ---------- API client ----------

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    ...(await authHeaders()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body as T;
}

function fetchTree(): Promise<OrgTreeResponse> {
  return request<OrgTreeResponse>(`${FN}?action=tree`);
}

interface BulkBody {
  scope: BulkScope;
  key: string;
  value?: string | number | boolean | null;
  delete?: boolean;
  confirm?: boolean;
}

function previewBulk(body: BulkBody): Promise<PreviewResponse> {
  return request<PreviewResponse>(`${FN}?action=bulk-attribute-preview`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function applyBulk(body: BulkBody): Promise<ApplyResponse> {
  return request<ApplyResponse>(`${FN}?action=bulk-attribute-apply`, {
    method: "POST",
    body: JSON.stringify({ ...body, confirm: true }),
  });
}

// ---------- Component ----------

const KEY_MAX = 64;
const VALUE_MAX = 500;
const CONFIRM_PHRASE = "APPLY";

export function BulkAttributesPage() {
  const toast = useToast();

  const tree = useQuery({
    queryKey: ["bulk-attrs-tree"],
    queryFn: fetchTree,
    staleTime: 60_000,
  });

  // Form state
  const [scopeType, setScopeType] = useState<ScopeType>("all");
  const [regionId, setRegionId] = useState<string>("");
  const [areaId, setAreaId] = useState<string>("");
  const [districtId, setDistrictId] = useState<string>("");
  const [operation, setOperation] = useState<Operation>("set");
  const [key, setKey] = useState<string>("");
  const [value, setValue] = useState<string>("");

  // Preview + apply state
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [confirmText, setConfirmText] = useState<string>("");
  const [result, setResult] = useState<ApplyResponse | null>(null);

  // Derived: dropdown options keyed off current selections.
  const regions = tree.data?.regions ?? [];
  const selectedRegion = regions.find((r) => r.id === regionId);
  const areas = selectedRegion?.areas ?? [];
  const selectedArea = areas.find((a) => a.id === areaId);
  const districts = selectedArea?.districts ?? [];

  // Resolve a BulkScope from the form. Returns null if the form is
  // incomplete (caller blocks preview button until valid).
  const scope: BulkScope | null = useMemo(() => {
    if (scopeType === "all") return { type: "all" };
    if (scopeType === "region" && regionId) return { type: "region", id: regionId };
    if (scopeType === "area" && areaId) return { type: "area", id: areaId };
    if (scopeType === "district" && districtId) return { type: "district", id: districtId };
    return null;
  }, [scopeType, regionId, areaId, districtId]);

  // Reset the dependent selections when the parent changes, so we
  // don't end up with stale UUIDs that no longer match the tree.
  useEffect(() => { setAreaId(""); setDistrictId(""); }, [regionId]);
  useEffect(() => { setDistrictId(""); }, [areaId]);
  // Clearing scope or operation invalidates a stale preview.
  useEffect(() => { setPreview(null); setConfirmText(""); setResult(null); }, [scope, operation, key, value]);

  const trimmedKey = key.trim();
  const canPreview =
    !!scope &&
    !!trimmedKey &&
    trimmedKey.length <= KEY_MAX &&
    (operation === "delete" || value.length <= VALUE_MAX);

  const previewMut = useMutation({
    mutationFn: () => previewBulk({
      scope: scope!,
      key: trimmedKey,
      value: operation === "delete" ? null : value,
      delete: operation === "delete",
    }),
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
      setConfirmText("");
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Preview failed.", "error"),
  });

  const applyMut = useMutation({
    mutationFn: () => applyBulk({
      scope: scope!,
      key: trimmedKey,
      value: operation === "delete" ? null : value,
      delete: operation === "delete",
    }),
    onSuccess: (data) => {
      setResult(data);
      setPreview(null);
      setConfirmText("");
      toast.push(
        `${data.operation === "delete" ? "Deleted" : "Set"} on ${data.updated} stores.`,
        "success",
      );
      tree.refetch();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Apply failed.", "error"),
  });

  const confirmReady = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;

  return (
    <>
      <PageHeader
        title="Bulk store attributes"
        description="Set or delete a single custom attribute across many stores at once."
      />

      {tree.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {tree.isError && (
        <EmptyState
          title="Couldn't load org tree"
          description={(tree.error as Error)?.message ?? "Try again."}
        />
      )}

      {tree.data && (
        <div className="space-y-4">
          {/* Scope picker */}
          <Card>
            <CardHeader title="Scope" description="Which stores will this affect?" />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "all",      label: "All active stores" },
                    { id: "region",   label: "By region" },
                    { id: "area",     label: "By area" },
                    { id: "district", label: "By district" },
                  ] as { id: ScopeType; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setScopeType(opt.id)}
                    className={
                      "rounded-md border px-3 py-1.5 text-sm transition " +
                      (scopeType === opt.id
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-midnight")
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {scopeType === "all" && (
                <p className="text-xs text-zinc-500">
                  All {tree.data.stats.active_stores ?? 0} active stores in the company.
                </p>
              )}

              {scopeType !== "all" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <NodeSelect
                    id="bulk-region"
                    label="Region"
                    value={regionId}
                    onChange={setRegionId}
                    options={regions.map((r) => ({
                      value: r.id,
                      label: r.code && r.name && r.code !== r.name
                        ? `${r.code} — ${r.name}` : (r.name ?? r.code ?? "")
                    }))}
                  />
                  {(scopeType === "area" || scopeType === "district") && (
                    <NodeSelect
                      id="bulk-area"
                      label="Area"
                      value={areaId}
                      onChange={setAreaId}
                      disabled={!regionId}
                      options={areas.map((a) => ({
                        value: a.id,
                        label: a.code && a.name && a.code !== a.name
                          ? `${a.code} — ${a.name}` : (a.name ?? a.code ?? "")
                      }))}
                    />
                  )}
                  {scopeType === "district" && (
                    <NodeSelect
                      id="bulk-district"
                      label="District"
                      value={districtId}
                      onChange={setDistrictId}
                      disabled={!areaId}
                      options={districts.map((d) => ({
                        value: d.id,
                        label: d.code && d.name && d.code !== d.name
                          ? `${d.code} — ${d.name}` : (d.name ?? d.code ?? "")
                      }))}
                    />
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Operation + key/value */}
          <Card>
            <CardHeader
              title="Operation"
              description="Set a key/value, or delete a key entirely."
            />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "set",    label: "Set key → value", icon: null },
                    { id: "delete", label: "Delete key",      icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> },
                  ] as { id: Operation; label: string; icon: React.ReactNode }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setOperation(opt.id)}
                    className={
                      "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition " +
                      (operation === opt.id
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-midnight")
                    }
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="bulk-key">Attribute key</Label>
                  <Input
                    id="bulk-key"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="e.g. manager_certification"
                    maxLength={KEY_MAX}
                  />
                </div>
                {operation === "set" && (
                  <div>
                    <Label htmlFor="bulk-value">Value</Label>
                    <Input
                      id="bulk-value"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="value (text)"
                      maxLength={VALUE_MAX}
                    />
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Preview action */}
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={() => previewMut.mutate()}
              disabled={!canPreview || previewMut.isPending}
            >
              {previewMut.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Previewing…
                </>
              ) : (
                "Preview"
              )}
            </Button>
            {(preview || result) && (
              <Button
                variant="ghost"
                onClick={() => { setPreview(null); setResult(null); setConfirmText(""); }}
              >
                Clear
              </Button>
            )}
          </div>

          {preview && !result && (
            <PreviewCard
              preview={preview}
              confirmText={confirmText}
              onConfirmTextChange={setConfirmText}
              confirmReady={confirmReady}
              applying={applyMut.isPending}
              onApply={() => applyMut.mutate()}
            />
          )}

          {result && <ResultCard result={result} />}
        </div>
      )}
    </>
  );
}

// ---------- subviews ----------

function NodeSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
      >
        <option value="">— Choose —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function PreviewCard({
  preview,
  confirmText,
  onConfirmTextChange,
  confirmReady,
  applying,
  onApply,
}: {
  preview: PreviewResponse;
  confirmText: string;
  onConfirmTextChange: (s: string) => void;
  confirmReady: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  const isDelete = preview.operation === "delete";
  return (
    <Card>
      <CardHeader
        title="Preview"
        description="Verify the count + sample before applying."
        actions={
          <Badge tone={isDelete ? "danger" : "info"}>
            {isDelete ? "Delete" : "Set"}
          </Badge>
        }
      />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Scope" value={preview.scope_label} />
          <Stat label="In scope" value={String(preview.in_scope_count)} />
          <Stat label="Already has key" value={String(preview.already_has_key_count)} />
          <Stat
            label="Will change"
            value={String(preview.will_change_count)}
            tone={preview.will_change_count > 0 ? "info" : "muted"}
          />
        </dl>

        <div className="rounded-md border border-zinc-100 bg-zinc-50 p-3 text-xs">
          <div className="font-mono">
            <span className="font-semibold text-midnight">{preview.key}</span>
            {!isDelete && (
              <>
                <span className="text-zinc-400"> → </span>
                <span className="text-midnight">{JSON.stringify(preview.value)}</span>
              </>
            )}
          </div>
        </div>

        {preview.already_has_key_count > 0 && !isDelete && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span>
              <strong>{preview.already_has_key_count}</strong> store
              {preview.already_has_key_count === 1 ? "" : "s"} already have the key{" "}
              <code className="font-mono">{preview.key}</code>. Applying will{" "}
              <strong>overwrite</strong> the existing value on those stores.
            </span>
          </div>
        )}

        {preview.sample_stores.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Sample stores ({preview.sample_stores.length} of {preview.in_scope_count})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {preview.sample_stores.map((s) => (
                <Badge key={s.id} tone="neutral">
                  #{s.number}
                  {s.name ? ` — ${s.name}` : ""}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {preview.will_change_count === 0 ? (
          <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
            No stores need updating — every store in scope already has this exact value.
          </div>
        ) : (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-red-700">
              Type <code className="rounded bg-white px-1.5 py-0.5 font-mono">{CONFIRM_PHRASE}</code> below to enable the apply button. This cannot be undone.
            </div>
            <Input
              value={confirmText}
              onChange={(e) => onConfirmTextChange(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              autoComplete="off"
              autoCapitalize="characters"
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={!confirmReady || applying}
                onClick={onApply}
              >
                {applying ? (
                  <>
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    Applying…
                  </>
                ) : (
                  `Apply to ${preview.will_change_count} store${preview.will_change_count === 1 ? "" : "s"}`
                )}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ResultCard({ result }: { result: ApplyResponse }) {
  return (
    <Card>
      <CardHeader
        title="Apply complete"
        description={`Operation ${result.bulk_operation_id.slice(0, 8)}…`}
        actions={<CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />}
      />
      <CardBody className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Operation" value={result.operation} />
          <Stat label="Key" value={result.key} />
          <Stat label="Updated" value={String(result.updated)} tone="success" />
          <Stat label="Skipped (no-op)" value={String(result.skipped)} tone="muted" />
        </dl>
        {result.errors.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <div className="mb-1 font-semibold">
              {result.errors.length} error{result.errors.length === 1 ? "" : "s"}:
            </div>
            <ul className="list-disc space-y-1 pl-4">
              {result.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  {e.number ? `Store #${e.number}: ` : ""}{e.error}
                </li>
              ))}
              {result.errors.length > 10 && (
                <li className="italic text-red-700">…and {result.errors.length - 10} more.</li>
              )}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "info" | "success" | "muted";
}) {
  const toneCls =
    tone === "info" ? "text-accent" :
    tone === "success" ? "text-emerald-600" :
    tone === "muted" ? "text-zinc-400" :
    "text-midnight";
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className={`mt-0.5 text-sm font-medium ${toneCls}`}>{value}</dd>
    </div>
  );
}
