// Read-only Vendor QR print panel for GMs and DOs. Shows the active
// QR token(s) for stores visible to the caller, with a Print button
// per token. NO create/revoke/copy-URL controls — those are
// admin-tier only and live on the separate "Vendor QR" management tab.
//
// GMs use this to print or re-print their store's sticker themselves
// without filing a request to admin.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Skeleton } from "@/shared/ui/Skeleton";
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/vendor-portal";

interface MyStoreToken {
  id: string;
  store_number: string;
  store_name: string | null;
  store_city: string | null;
  store_state: string | null;
  token: string;
  label: string | null;
  expires_at: string | null;
}

async function authedFetch<T>(url: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const sessionToken = data.session?.access_token;
  const res = await fetch(url, {
    headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
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

function fetchMyStoreTokens() {
  return authedFetch<{ ok: true; tokens: MyStoreToken[] }>(
    `${FN}?action=myStoreTokens`,
  );
}

export function MyStoreQrPanel() {
  const q = useQuery({
    queryKey: ["wo2", "my-store-qr"],
    queryFn: fetchMyStoreTokens,
    staleTime: 60_000,
  });
  const tokens = q.data?.tokens || [];

  // Group tokens by store so a GM with multiple stickers per store
  // (front + back-of-house) sees them grouped under one heading.
  const grouped = useMemo(() => {
    const map = new Map<string, { store_number: string; store_name: string | null; tokens: MyStoreToken[] }>();
    for (const t of tokens) {
      if (!map.has(t.store_number)) {
        map.set(t.store_number, {
          store_number: t.store_number,
          store_name: t.store_name,
          tokens: [],
        });
      }
      map.get(t.store_number)!.tokens.push(t);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.store_number.localeCompare(b.store_number),
    );
  }, [tokens]);

  return (
    <>
      <div className="mb-4 max-w-2xl text-xs text-zinc-500">
        Print the QR sticker for your store and post it where vendors check in
        (back-of-house door is a good spot). Vendors scan it to mark on-site,
        completed, or submit a quote — no login required. If your store needs
        a new code, ask an admin or an SDO to mint one.
      </div>

      {q.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
        </div>
      )}
      {q.isError && (
        <EmptyState
          title="Couldn't load your store QR"
          description={(q.error as Error)?.message ?? "Try again."}
        />
      )}
      {!q.isLoading && !q.isError && grouped.length === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <div>
              <div className="font-semibold">No active vendor QR for your store yet.</div>
              <div className="mt-1 text-amber-800">
                Ask an admin (or any SDO+) to mint one — they can create it from
                Work Orders V2 → Vendor QR → New QR. Once it's active you'll
                see it here and can print it directly.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {grouped.map((g) => (
          <StoreTokenGroup key={g.store_number} group={g} />
        ))}
      </div>
    </>
  );
}

function StoreTokenGroup({
  group,
}: {
  group: { store_number: string; store_name: string | null; tokens: MyStoreToken[] };
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            Store {group.store_number}
            {group.store_name && (
              <span className="text-xs font-normal text-zinc-500">· {group.store_name}</span>
            )}
            <Badge tone="success">Active</Badge>
          </span>
        }
        description={
          group.tokens.length > 1
            ? <span className="text-xs text-zinc-500">{group.tokens.length} stickers issued for this store</span>
            : undefined
        }
      />
      <CardBody className="space-y-3">
        {group.tokens.map((t) => (
          <PrintableSticker key={t.id} token={t} />
        ))}
      </CardBody>
    </Card>
  );
}

function PrintableSticker({ token }: { token: MyStoreToken }) {
  const url = `${window.location.origin}/v/${token.token}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  const [printing, setPrinting] = useState(false);

  function handlePrint() {
    setPrinting(true);
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) {
      setPrinting(false);
      return;
    }
    const safeNumber = escapeForPrint(token.store_number);
    const safeName = token.store_name ? escapeForPrint(token.store_name) : "";
    const labelLine = token.label ? `<div class="label">${escapeForPrint(token.label)}</div>` : "";
    // Bigger size on the printed QR — 320x320 reads better from a
    // few feet away when stuck to a back-of-house door.
    const printSrc = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}`;
    w.document.write(`
      <html>
      <head>
        <title>Vendor QR — Store ${safeNumber}</title>
        <style>
          @page { margin: 0.5in; }
          body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; padding: 24px; text-align: center; color: #111; }
          h1 { font-size: 22px; margin: 0 0 8px 0; }
          .store-number {
            font-size: 92px;
            font-weight: 800;
            line-height: 1;
            letter-spacing: -0.02em;
            margin: 8px 0 4px 0;
          }
          .store-name { font-size: 16px; color: #555; margin-bottom: 20px; }
          .label { font-size: 12px; color: #777; margin-top: -8px; margin-bottom: 16px; }
          img { display: block; margin: 0 auto 16px auto; }
          .instruct { font-size: 14px; color: #333; line-height: 1.5; max-width: 360px; margin: 0 auto; }
          .instruct strong { color: #111; }
          .footer { margin-top: 24px; font-size: 10px; color: #999; }
        </style>
      </head>
      <body>
        <h1>Vendor Quick Update</h1>
        <div class="store-number">${safeNumber}</div>
        ${safeName ? `<div class="store-name">${safeName}</div>` : ""}
        ${labelLine}
        <img src="${printSrc}" alt="QR code" width="320" height="320" />
        <div class="instruct">
          Scan with your phone camera to mark <strong>on-site</strong>,
          mark <strong>completed</strong>, submit a <strong>quote</strong>,
          or upload <strong>photos</strong>. No login required.
        </div>
        <div class="footer">SOAR Hub Vendor Portal · Store ${safeNumber}</div>
      </body>
      </html>
    `);
    w.document.close();
    setTimeout(() => {
      w.print();
      setPrinting(false);
    }, 500);
  }

  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[140px_1fr]">
      <div className="flex justify-center sm:block">
        <img
          src={qrSrc}
          alt={`QR code for store ${token.store_number}`}
          width={140}
          height={140}
          className="rounded-md border border-zinc-200 bg-white p-1"
        />
      </div>
      <div>
        {token.label && (
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">{token.label}</div>
        )}
        <div className="mt-1 text-xs text-zinc-600">
          Vendors scan this and land on a page showing only your store's open
          work orders. They identify themselves and can mark on-site, complete
          the job, or submit a quote.
        </div>
        {token.expires_at && (
          <div className="mt-1 text-[11px] text-zinc-500">
            Sticker valid through {new Date(token.expires_at).toLocaleDateString()}
          </div>
        )}
        <div className="mt-3">
          <Button variant="primary" onClick={handlePrint} disabled={printing}>
            {printing
              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              : <Printer className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />}
            Print sticker
          </Button>
        </div>
      </div>
    </div>
  );
}

function escapeForPrint(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
