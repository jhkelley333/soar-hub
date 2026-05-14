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
  Copy,
  Eye,
  Loader2,
  Plus,
  Printer,
  ShieldOff,
  X,
} from "lucide-react";
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
  const [storeFilter, setStoreFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const q = useQuery({
    queryKey: ["wo2", "qr-tokens", storeFilter],
    queryFn: () => listTokens(storeFilter || undefined),
    staleTime: 30_000,
  });

  const tokens = q.data?.tokens || [];

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs text-zinc-500">
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
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ["wo2", "qr-tokens"] });
            toast.push("Token created.", "success");
          }}
          onError={(msg) => toast.push(msg, "error")}
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
  onClose, onCreated, onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [storeNumber, setStoreNumber] = useState("");
  const [label, setLabel] = useState("");
  const [ttlDays, setTtlDays] = useState("365");

  const mut = useMutation({
    mutationFn: () => {
      if (!storeNumber.trim()) {
        return Promise.reject(new Error("Store number is required."));
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
            <Label htmlFor="qr-store">Store number *</Label>
            <Input
              id="qr-store"
              value={storeNumber}
              onChange={(e) => setStoreNumber(e.target.value)}
              placeholder="e.g. 1242"
              autoFocus
            />
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
          <Button variant="primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
        </div>
      </div>
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
