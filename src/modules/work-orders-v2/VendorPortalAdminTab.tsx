// Admin-only tab on Work Orders V2 for managing the per-store QR
// vendor tokens. Generate a token for a store, revoke a leaked one,
// view recent visit counts. Each row exposes the full QR URL and a
// canvas-rendered QR image so an admin can print the sticker.
//
// Admins are responsible for printing + posting. No automated
// distribution to vendors — they scan when they arrive.

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  Layers,
  Loader2,
  Plus,
  Printer,
  ShieldOff,
  X,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/vendor-portal";

interface QrToken {
  id: string;
  store_number: string;
  token: string;
  label: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  created_by_id: string | null;
  revoked_by_id: string | null;
  visit_count: number;
  last_visit_at: string | null;
}

async function authedFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { ok?: boolean }).ok === false) {
    throw new Error(
      (body as { message?: string; error?: string }).message ||
      (body as { error?: string }).error ||
      `HTTP ${res.status}`,
    );
  }
  return body as T;
}

function listTokens(storeFilter?: string) {
  const qs = storeFilter ? `&store=${encodeURIComponent(storeFilter)}` : "";
  return authedFetch<{ ok: true; tokens: QrToken[] }>(`${FN}?action=adminList${qs}`);
}

function createToken(payload: { store_number: string; label?: string; ttl_days?: number }) {
  return authedFetch<{ ok: true; token: QrToken }>(`${FN}?action=adminCreate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function revokeToken(id: string) {
  return authedFetch<{ ok: true }>(`${FN}?action=adminRevoke`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

interface BulkCreateBody {
  mode: "all_missing" | "specific";
  store_numbers?: string[];
  label?: string;
  ttl_days?: number;
}
interface BulkCreateResult {
  store_number: string;
  status: "created" | "skipped" | "failed";
  message?: string;
  token?: { id: string; token: string; store_number: string };
}
interface BulkCreateResponse {
  ok: true;
  results: BulkCreateResult[];
  summary: Partial<Record<"created" | "skipped" | "failed", number>>;
}

function bulkCreate(payload: BulkCreateBody): Promise<BulkCreateResponse> {
  return authedFetch<BulkCreateResponse>(`${FN}?action=adminBulkCreate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

interface StoreLite {
  id: string;
  number: string;
  name: string | null;
}

// Small store-list fetcher. Reads from PostgREST directly (active
// stores only) for the picker dropdowns.
async function fetchActiveStores(): Promise<StoreLite[]> {
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase
    .from("stores")
    .select("id, number, name, is_active")
    .eq("is_active", true)
    .order("number");
  if (error) throw new Error(error.message);
  return (data || []).map((s: { id: string; number: string; name: string | null }) => ({
    id: s.id, number: String(s.number), name: s.name,
  }));
}

interface VendorVisitRow {
  id: string;
  token_id: string;
  ticket_id: string | null;
  store_number: string | null;
  token_label: string | null;
  token_active: boolean | null;
  token_expires_at: string | null;
  vendor_name: string | null;
  vendor_company: string | null;
  vendor_phone: string | null;
  action: string;
  notes: string | null;
  remote_ip: string | null;
  user_agent: string | null;
  created_at: string;
  flags: { key: string; severity: "info" | "warning" | "danger"; label: string }[];
}

function listVisits(days: number) {
  return authedFetch<{
    ok: true;
    visits: VendorVisitRow[];
    flag_summary: Record<string, number>;
  }>(`${FN}?action=adminListVisits&days=${days}`);
}

export function VendorPortalAdminTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [storeFilter, setStoreFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const q = useQuery({
    queryKey: ["wo2", "qr-tokens", storeFilter],
    queryFn: () => listTokens(storeFilter || undefined),
    staleTime: 30_000,
  });

  const storesQ = useQuery({
    queryKey: ["wo2", "active-stores"],
    queryFn: fetchActiveStores,
    staleTime: 5 * 60_000,
  });

  const tokens = q.data?.tokens || [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-md text-xs text-zinc-500">
          One QR per store. Vendors scan to mark on-site / completed and submit quotes.
          Tokens are revocable; new ones can be issued any time.
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            placeholder="Filter by store #…"
            className="w-40"
          />
          {isAdmin && (
            <Button variant="ghost" onClick={() => setBulkOpen(true)}>
              <Layers className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Bulk create
            </Button>
          )}
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
            New QR
          </Button>
        </div>
      </div>

      {q.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
      {q.isError && (
        <EmptyState
          title="Couldn't load tokens"
          description={(q.error as Error)?.message ?? "Try again."}
        />
      )}
      {!q.isLoading && !q.isError && tokens.length === 0 && (
        <EmptyState
          title="No vendor QR tokens yet"
          description="Click 'New QR' to mint one for a store."
        />
      )}

      <div className="space-y-3">
        {tokens.map((t) => (
          <TokenRow
            key={t.id}
            token={t}
            onRevoke={() =>
              revokeToken(t.id).then(
                () => {
                  toast.push("Token revoked.", "success");
                  qc.invalidateQueries({ queryKey: ["wo2", "qr-tokens"] });
                },
                (e: Error) => toast.push(e.message, "error"),
              )
            }
          />
        ))}
      </div>

      {createOpen && (
        <CreateTokenModal
          stores={storesQ.data || []}
          existingTokens={tokens}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ["wo2", "qr-tokens"] });
            toast.push("Token created.", "success");
          }}
          onError={(msg) => toast.push(msg, "error")}
        />
      )}

      {bulkOpen && isAdmin && (
        <BulkCreateModal
          stores={storesQ.data || []}
          existingTokens={tokens}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["wo2", "qr-tokens"] });
          }}
        />
      )}

      <RecentActivitySection />
    </>
  );
}

// ── Recent Activity section ──────────────────────────────────────
//
// Lives below the token list. Pulls vendor_visits in a configurable
// window, decorates each row with the server-computed flags, and
// renders flagged rows with prominent badges.

function RecentActivitySection() {
  const [days, setDays] = useState<number>(7);
  const [selected, setSelected] = useState<VendorVisitRow | null>(null);
  const [showOnlyFlagged, setShowOnlyFlagged] = useState(false);

  const q = useQuery({
    queryKey: ["wo2", "qr-visits", days],
    queryFn: () => listVisits(days),
    staleTime: 30_000,
  });

  const rows = q.data?.visits || [];
  const summary = q.data?.flag_summary || {};
  const filtered = useMemo(
    () => showOnlyFlagged ? rows.filter((r) => r.flags.length > 0) : rows,
    [rows, showOnlyFlagged],
  );

  return (
    <div className="mt-8 border-t border-zinc-200 pt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold tracking-tight text-midnight">
            Recent Vendor Activity
          </div>
          <div className="text-xs text-zinc-500">
            Every scan and action across vendor QR tokens you can see.
            Flags highlight patterns that might warrant attention.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-zinc-700">
            <input
              type="checkbox"
              checked={showOnlyFlagged}
              onChange={(e) => setShowOnlyFlagged(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            Flagged only
          </label>
        </div>
      </div>

      {/* Flag summary tiles */}
      {Object.keys(summary).length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(summary).map(([key, count]) => (
            <div
              key={key}
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px]"
            >
              <div className="font-semibold text-amber-900">{count}</div>
              <div className="text-amber-800">{flagLabel(key)}</div>
            </div>
          ))}
        </div>
      )}

      {q.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}
      {q.isError && (
        <EmptyState
          title="Couldn't load activity"
          description={(q.error as Error)?.message ?? "Try again."}
        />
      )}
      {!q.isLoading && !q.isError && filtered.length === 0 && (
        <EmptyState
          title={showOnlyFlagged ? "No flagged activity" : "No activity yet"}
          description={
            showOnlyFlagged
              ? "Vendor scans are within expected patterns."
              : "Once vendors scan their QR codes, their actions will appear here."
          }
        />
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-md border border-zinc-200">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Flags</th>
                <th className="px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((v) => (
                <tr
                  key={v.id}
                  className={
                    "transition hover:bg-zinc-50 " +
                    (v.flags.some((f) => f.severity === "danger")
                      ? "bg-red-50/50"
                      : v.flags.length > 0 ? "bg-amber-50/50" : "")
                  }
                >
                  <td className="px-3 py-2 text-zinc-700">
                    <div>{new Date(v.created_at).toLocaleString()}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-700">
                    {v.store_number || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-midnight">{v.vendor_name || "—"}</div>
                    {v.vendor_company && (
                      <div className="text-[10px] text-zinc-500">{v.vendor_company}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ActionBadge action={v.action} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {v.flags.map((f) => <FlagBadge key={f.key} flag={f} />)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(v)}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:border-accent hover:text-accent"
                    >
                      <Eye className="h-3 w-3" strokeWidth={1.75} />
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <VisitDetailModal visit={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const tone =
    action === "completed" ? "bg-emerald-100 text-emerald-900" :
    action === "on_site"   ? "bg-blue-100    text-blue-900" :
    action === "quote_submitted" ? "bg-violet-100 text-violet-900" :
    action === "photo_added"     ? "bg-zinc-100   text-zinc-700" :
                                   "bg-zinc-100   text-zinc-600";
  const labels: Record<string, string> = {
    on_site: "On Site",
    completed: "Completed",
    quote_submitted: "Quote",
    photo_added: "Photo",
    view: "Viewed",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      {labels[action] || action}
    </span>
  );
}

function FlagBadge({ flag }: { flag: VendorVisitRow["flags"][number] }) {
  const tone =
    flag.severity === "danger"  ? "bg-red-100 text-red-900 border-red-200" :
    flag.severity === "warning" ? "bg-amber-100 text-amber-900 border-amber-200" :
                                  "bg-blue-100 text-blue-900 border-blue-200";
  return (
    <span
      title={flag.label}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}
    >
      <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} />
      {flag.label}
    </span>
  );
}

function flagLabel(key: string): string {
  const map: Record<string, string> = {
    multi_ip:          "Multiple IPs",
    high_velocity:     "High velocity",
    driveby_complete:  "Drive-by complete",
    no_photo_evidence: "No photo evidence",
  };
  return map[key] || key;
}

function VisitDetailModal({
  visit, onClose,
}: { visit: VendorVisitRow; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold text-midnight">Vendor Visit Detail</div>
          <button
            type="button" onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          {visit.flags.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                Flags
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {visit.flags.map((f) => <FlagBadge key={f.key} flag={f} />)}
              </div>
            </div>
          )}
          <DetailRow label="When" value={new Date(visit.created_at).toLocaleString()} />
          <DetailRow label="Store" value={visit.store_number || "—"} />
          <DetailRow
            label="Action"
            value={<ActionBadge action={visit.action} />}
          />
          {visit.ticket_id && (
            <DetailRow label="Ticket" value={<span className="font-mono">{visit.ticket_id}</span>} />
          )}
          <DetailRow label="Vendor name" value={visit.vendor_name || "—"} />
          {visit.vendor_company && <DetailRow label="Company" value={visit.vendor_company} />}
          {visit.vendor_phone && <DetailRow label="Phone" value={visit.vendor_phone} />}
          {visit.notes && <DetailRow label="Notes" value={visit.notes} />}
          <DetailRow label="IP" value={<span className="font-mono">{visit.remote_ip || "—"}</span>} />
          <DetailRow
            label="User agent"
            value={<span className="break-all font-mono text-[10px]">{visit.user_agent || "—"}</span>}
          />
          <DetailRow label="Token label" value={visit.token_label || "—"} />
          <DetailRow
            label="Token status"
            value={visit.token_active ? "Active" : "Revoked"}
          />
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="col-span-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="col-span-2 text-sm text-midnight">{value}</div>
    </div>
  );
}

function tokenUrl(t: QrToken): string {
  return `${window.location.origin}/v/${t.token}`;
}

function TokenRow({
  token, onRevoke,
}: {
  token: QrToken;
  onRevoke: () => void;
}) {
  const url = tokenUrl(token);
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            Store {token.store_number}
            {token.is_active
              ? <Badge tone="success">Active</Badge>
              : <Badge tone="neutral">Revoked</Badge>}
            {token.label && <span className="text-xs font-normal text-zinc-500">· {token.label}</span>}
          </span>
        }
        description={
          <span className="text-xs text-zinc-500">
            Created {new Date(token.created_at).toLocaleDateString()}
            {token.expires_at && ` · Expires ${new Date(token.expires_at).toLocaleDateString()}`}
            {token.revoked_at && ` · Revoked ${new Date(token.revoked_at).toLocaleDateString()}`}
          </span>
        }
      />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px]">
          <div className="space-y-2">
            <div>
              <Label>Vendor URL</Label>
              <div className="mt-1 flex items-center gap-2">
                <code className="block flex-1 truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono text-[11px] text-midnight">
                  {url}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(url);
                  }}
                  title="Copy URL"
                  className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:bg-zinc-50"
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </div>
            <div className="text-[11px] text-zinc-500">
              {token.visit_count} scan{token.visit_count === 1 ? "" : "s"}
              {token.last_visit_at && ` · last ${new Date(token.last_visit_at).toLocaleString()}`}
            </div>
            {token.is_active && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Revoke this QR token for Store ${token.store_number}? Any vendor who scans it after this will see "QR code not active." This cannot be undone — mint a new token if you want to issue a replacement.`)) {
                    onRevoke();
                  }
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-900"
              >
                <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                Revoke
              </button>
            )}
          </div>
          <QrPanel url={url} active={token.is_active} />
        </div>
      </CardBody>
    </Card>
  );
}

function CreateTokenModal({
  stores, existingTokens, onClose, onCreated, onError,
}: {
  stores: StoreLite[];
  existingTokens: QrToken[];
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [storeNumber, setStoreNumber] = useState("");
  const [label, setLabel] = useState("");
  const [ttlDays, setTtlDays] = useState("365");

  // Stores that already have an active token — surfaced as a warning
  // chip so the admin doesn't accidentally mint a duplicate. We DON'T
  // block submission; the backend allows multiple tokens per store
  // (e.g. one for back-of-house + one for the manager's clipboard)
  // and would just create another active row.
  const activeStoreNumbers = useMemo(
    () => new Set(existingTokens.filter((t) => t.is_active).map((t) => t.store_number)),
    [existingTokens],
  );
  const storesWithoutToken = useMemo(
    () => stores.filter((s) => !activeStoreNumbers.has(s.number)),
    [stores, activeStoreNumbers],
  );
  const storesWithToken = useMemo(
    () => stores.filter((s) => activeStoreNumbers.has(s.number)),
    [stores, activeStoreNumbers],
  );

  const mut = useMutation({
    mutationFn: () => {
      if (!storeNumber.trim()) {
        return Promise.reject(new Error("Pick a store."));
      }
      return createToken({
        store_number: storeNumber.trim(),
        label: label.trim() || undefined,
        ttl_days: Number(ttlDays) || 365,
      });
    },
    onSuccess: onCreated,
    onError: (e: unknown) => onError(e instanceof Error ? e.message : "Create failed."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="border-b border-zinc-100 px-5 py-3 text-base font-semibold text-midnight">
          New vendor QR token
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <Label htmlFor="qr-store">Store *</Label>
            <select
              id="qr-store"
              value={storeNumber}
              onChange={(e) => setStoreNumber(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              autoFocus
            >
              <option value="">Pick a store…</option>
              {storesWithoutToken.length > 0 && (
                <optgroup label="Without active token">
                  {storesWithoutToken.map((s) => (
                    <option key={s.id} value={s.number}>
                      {s.number}{s.name ? ` — ${s.name}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {storesWithToken.length > 0 && (
                <optgroup label="Already has an active token">
                  {storesWithToken.map((s) => (
                    <option key={s.id} value={s.number}>
                      {s.number}{s.name ? ` — ${s.name}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {storeNumber && activeStoreNumbers.has(storeNumber) && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                This store already has an active token — minting a second one is allowed but uncommon.
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="qr-label">Label (optional)</Label>
            <Input
              id="qr-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder='e.g. "back-of-house sticker"'
            />
          </div>
          <div>
            <Label htmlFor="qr-ttl">Expires in (days)</Label>
            <Input
              id="qr-ttl"
              type="number"
              min={1}
              value={ttlDays}
              onChange={(e) => setTtlDays(e.target.value)}
            />
            <div className="mt-1 text-[10px] text-zinc-500">
              Default 365. Rotate annually to limit exposure if a sticker leaks.
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !storeNumber}
          >
            {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk Create Modal ────────────────────────────────────────────

function BulkCreateModal({
  stores, existingTokens, onClose, onDone,
}: {
  stores: StoreLite[];
  existingTokens: QrToken[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"all_missing" | "specific">("all_missing");
  const [pastedList, setPastedList] = useState("");
  const [label, setLabel] = useState("");
  const [ttlDays, setTtlDays] = useState("365");
  const [results, setResults] = useState<BulkCreateResult[] | null>(null);
  const [summary, setSummary] = useState<BulkCreateResponse["summary"] | null>(null);

  const activeStoreNumbers = useMemo(
    () => new Set(existingTokens.filter((t) => t.is_active).map((t) => t.store_number)),
    [existingTokens],
  );

  const targetCount = useMemo(() => {
    if (mode === "all_missing") {
      return stores.filter((s) => !activeStoreNumbers.has(s.number)).length;
    }
    return pastedList
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean).length;
  }, [mode, stores, activeStoreNumbers, pastedList]);

  const mut = useMutation({
    mutationFn: async () => {
      const payload: BulkCreateBody = {
        mode,
        label: label.trim() || undefined,
        ttl_days: Number(ttlDays) || 365,
      };
      if (mode === "specific") {
        payload.store_numbers = pastedList
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (!payload.store_numbers.length) {
          throw new Error("Paste at least one store number.");
        }
      }
      return bulkCreate(payload);
    },
    onSuccess: (r) => {
      setResults(r.results);
      setSummary(r.summary);
      onDone();
    },
  });

  const showResults = results !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !mut.isPending) onClose(); }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold text-midnight">Bulk-create vendor QR tokens</div>
          <button
            type="button" onClick={onClose} disabled={mut.isPending}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {!showResults ? (
          <>
            <div className="space-y-4 px-5 py-4">
              <div>
                <Label>Which stores</Label>
                <div className="mt-1 space-y-2">
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 bg-white p-3 hover:border-accent">
                    <input
                      type="radio" name="bulk-mode"
                      checked={mode === "all_missing"}
                      onChange={() => setMode("all_missing")}
                      className="mt-0.5 h-4 w-4 accent-accent"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-midnight">
                        All active stores without an active token
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        Skips stores that already have one. Safe to re-run.
                      </div>
                      <div className="mt-1 text-[11px] font-semibold text-accent">
                        {mode === "all_missing" ? `${targetCount} store${targetCount === 1 ? "" : "s"} will get a new token` : ""}
                      </div>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 bg-white p-3 hover:border-accent">
                    <input
                      type="radio" name="bulk-mode"
                      checked={mode === "specific"}
                      onChange={() => setMode("specific")}
                      className="mt-0.5 h-4 w-4 accent-accent"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-midnight">
                        Specific stores (paste a list)
                      </div>
                      <textarea
                        value={pastedList}
                        onChange={(e) => setPastedList(e.target.value)}
                        rows={3}
                        placeholder="1242, 1945, 2167"
                        disabled={mode !== "specific"}
                        className="mt-1 block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-mono text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-zinc-50"
                      />
                      <div className="mt-1 text-[11px] text-zinc-500">
                        Comma- or whitespace-separated store numbers. Stores that already
                        have an active token will be skipped.
                      </div>
                      {mode === "specific" && targetCount > 0 && (
                        <div className="mt-1 text-[11px] font-semibold text-accent">
                          {targetCount} store{targetCount === 1 ? "" : "s"} in your list
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bulk-label">Label (applied to all)</Label>
                  <Input
                    id="bulk-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder='e.g. "v2 rollout"'
                  />
                </div>
                <div>
                  <Label htmlFor="bulk-ttl">Expires in (days)</Label>
                  <Input
                    id="bulk-ttl"
                    type="number" min={1}
                    value={ttlDays}
                    onChange={(e) => setTtlDays(e.target.value)}
                  />
                </div>
              </div>

              {mut.isError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                  {(mut.error as Error).message}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
              <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => mut.mutate()}
                disabled={mut.isPending || targetCount === 0 || targetCount > 500}
              >
                {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {mut.isPending
                  ? `Minting ${targetCount}…`
                  : `Mint ${targetCount} token${targetCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        ) : (
          <BulkCreateResultsView
            results={results || []}
            summary={summary || {}}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function BulkCreateResultsView({
  results, summary, onClose,
}: {
  results: BulkCreateResult[];
  summary: BulkCreateResponse["summary"];
  onClose: () => void;
}) {
  const created = results.filter((r) => r.status === "created");
  const skipped = results.filter((r) => r.status === "skipped");
  const failed  = results.filter((r) => r.status === "failed");

  return (
    <>
      <div className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-3 gap-2">
          <ResultTile tone="success" count={summary.created || 0} label="Created" />
          <ResultTile tone="neutral" count={summary.skipped || 0} label="Skipped" />
          <ResultTile tone="danger"  count={summary.failed  || 0} label="Failed" />
        </div>
        {failed.length > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-red-900">
              Failures
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-red-900">
              {failed.map((r) => (
                <li key={r.store_number} className="font-mono">
                  Store {r.store_number}: {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <details className="rounded-md border border-zinc-200 bg-white p-3 text-xs" open={false}>
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Per-store breakdown ({results.length})
          </summary>
          <ul className="mt-2 max-h-60 space-y-0.5 overflow-y-auto">
            {[...created, ...skipped, ...failed].map((r) => (
              <li key={r.store_number} className="flex items-center gap-2">
                {r.status === "created" && <CheckCircle2 className="h-3 w-3 text-emerald-600" strokeWidth={2} />}
                {r.status === "skipped" && <span className="h-3 w-3 rounded-full bg-zinc-300" />}
                {r.status === "failed"  && <AlertTriangle className="h-3 w-3 text-red-600" strokeWidth={2} />}
                <span className="font-mono">Store {r.store_number}</span>
                {r.message && <span className="text-zinc-500">— {r.message}</span>}
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </>
  );
}

function ResultTile({
  tone, count, label,
}: {
  tone: "success" | "neutral" | "danger";
  count: number;
  label: string;
}) {
  const cls =
    tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" :
    tone === "danger"  ? "border-red-200 bg-red-50 text-red-900" :
                         "border-zinc-200 bg-zinc-50 text-zinc-700";
  return (
    <div className={`rounded-md border px-3 py-2 ${cls}`}>
      <div className="text-lg font-semibold tabular-nums">{count}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide">{label}</div>
    </div>
  );
}

// QR panel — renders a QR via an external image API so we don't have
// to bundle a generator. Falls back to the URL text if the image
// fails to load. Includes a Print button.
function QrPanel({ url, active }: { url: string; active: boolean }) {
  const printRef = useRef<HTMLDivElement>(null);
  // QR image via a stable, no-cost CDN. If you don't want a third
  // party dependency we can swap to a JS generator (~3kb gzipped).
  const qrSrc = useMemo(
    () => `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`,
    [url],
  );

  function printQr() {
    if (!printRef.current) return;
    const w = window.open("", "_blank", "width=400,height=500");
    if (!w) return;
    w.document.write(`
      <html><head><title>Vendor QR</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 24px; text-align: center; }
        img { display: block; margin: 24px auto; }
        .url { font-family: monospace; font-size: 11px; color: #666; word-break: break-all; }
        h1 { font-size: 18px; }
        p { font-size: 13px; color: #444; }
      </style>
      </head><body>
        <h1>Vendor Quick Update</h1>
        <p>Scan to mark on-site, completed, or submit a quote.</p>
        <img src="${qrSrc}" alt="QR code" width="240" height="240" />
        <div class="url">${url}</div>
      </body></html>
    `);
    w.document.close();
    setTimeout(() => { w.print(); }, 500);
  }

  return (
    <div className="flex flex-col items-center gap-2" ref={printRef}>
      <div
        className={
          "overflow-hidden rounded-md border bg-white p-1 " +
          (active ? "border-zinc-200" : "border-zinc-200 opacity-40")
        }
      >
        <img
          src={qrSrc}
          alt="QR code for vendor portal"
          width={100}
          height={100}
          className="block"
        />
      </div>
      {active && (
        <button
          type="button"
          onClick={printQr}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
        >
          <Printer className="h-3 w-3" strokeWidth={1.75} />
          Print
        </button>
      )}
    </div>
  );
}
