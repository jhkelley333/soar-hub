// QR Codes — a Flowcode-style dynamic QR generator for GM and above. Mint a
// code, print/share the QR, then repoint its destination anytime without
// reprinting. Reached from the Operations Tools hub (/operations).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  QrCode as QrIcon, Plus, Link as LinkIcon, Download, Copy, Check, Trash2, Power, ExternalLink, Loader2,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import {
  listQrCodes, createQrCode, updateQrCode, setQrActive, deleteQrCode, publicQrUrl, type QrCode,
} from "./api";

// ── QR rendering (via the `qrcode` lib) ─────────────────────────────────────
function useQrDataUrl(value: string, size = 148): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then((u) => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setUrl(""); });
    return () => { alive = false; };
  }, [value, size]);
  return url;
}

function downloadQr(value: string, filename: string) {
  QRCode.toDataURL(value, { width: 1024, margin: 2, errorCorrectionLevel: "M" }).then((u) => {
    const a = document.createElement("a");
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:bg-zinc-50 dark:border-night-line"
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : label}
    </button>
  );
}

// ── One QR card (preview + inline edit of label/destination) ────────────────
function QrCard({ qr }: { qr: QrCode }) {
  const qc = useQueryClient();
  const url = publicQrUrl(qr.code);
  const img = useQrDataUrl(url);
  const [label, setLabel] = useState(qr.label);
  const [target, setTarget] = useState(qr.target_url);
  const [err, setErr] = useState<string | null>(null);

  // Keep local fields in sync if the row changes underneath us (e.g. refetch).
  useEffect(() => { setLabel(qr.label); setTarget(qr.target_url); }, [qr.label, qr.target_url]);

  const dirty = label.trim() !== qr.label || target.trim() !== qr.target_url;

  const save = useMutation({
    mutationFn: () => updateQrCode({ id: qr.id, label: label.trim(), target_url: target.trim() }),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ["qr-codes"] }); },
    onError: (e: Error) => setErr(e.message),
  });
  const toggle = useMutation({
    mutationFn: () => setQrActive(qr.id, !qr.is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qr-codes"] }),
  });
  const remove = useMutation({
    mutationFn: () => deleteQrCode(qr.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qr-codes"] }),
  });

  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-card dark:bg-night-raised ${qr.is_active ? "border-zinc-200 dark:border-night-line" : "border-dashed border-zinc-300 opacity-75 dark:border-night-line"}`}>
      <div className="flex gap-4">
        {/* QR preview */}
        <div className="shrink-0">
          <div className="rounded-xl border border-zinc-200 bg-white p-2 dark:border-night-line">
            {img ? <img src={img} alt={`QR for ${qr.label}`} className="h-[120px] w-[120px]" /> : <div className="h-[120px] w-[120px] animate-pulse rounded bg-zinc-100" />}
          </div>
          <div className="mt-1.5 text-center font-mono text-[11px] text-ink-subtle">{qr.code}</div>
        </div>

        {/* Details + edit */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${qr.is_active ? "bg-emerald-500/10 text-emerald-600" : "bg-zinc-200 text-zinc-500"}`}>
              {qr.is_active ? "Active" : "Off"}
            </span>
            <span className="text-[11px] text-ink-subtle">{qr.scan_count} scan{qr.scan_count === 1 ? "" : "s"}</span>
          </div>

          <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-night-line dark:bg-night-base"
          />

          <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Points to</label>
          <div className="mt-0.5 flex gap-1.5">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-night-line dark:bg-night-base"
            />
            <a href={target} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-zinc-200 px-2 text-ink-muted hover:bg-zinc-50 dark:border-night-line" title="Open destination">
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          {err && <p className="mt-1.5 text-xs text-red-600">{err}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save changes
            </button>
            <CopyButton text={url} />
            <button type="button" onClick={() => downloadQr(url, `qr-${qr.code}.png`)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:bg-zinc-50 dark:border-night-line">
              <Download className="h-3.5 w-3.5" /> PNG
            </button>
            <button type="button" onClick={() => toggle.mutate()} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:bg-zinc-50 dark:border-night-line">
              <Power className="h-3.5 w-3.5" /> {qr.is_active ? "Deactivate" : "Activate"}
            </button>
            <button
              type="button"
              onClick={() => { if (confirm(`Delete “${qr.label}”? The QR will stop working immediately.`)) remove.mutate(); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
          {qr.created_by_name && <p className="mt-2 text-[11px] text-ink-subtle">Created by {qr.created_by_name}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Create form ─────────────────────────────────────────────────────────────
function CreateForm() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createQrCode({ label: label.trim(), target_url: target.trim() }),
    onSuccess: () => { setLabel(""); setTarget(""); setErr(null); qc.invalidateQueries({ queryKey: ["qr-codes"] }); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (label.trim() && target.trim()) create.mutate(); }}
      className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-card dark:border-night-line dark:bg-night-raised"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-ink dark:text-night-ink">
        <Plus className="h-4 w-4 text-accent" /> New QR code
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Drive-thru menu" className="mt-0.5 w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm dark:border-night-line dark:bg-night-base" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Destination URL</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://example.com/menu" className="mt-0.5 w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-sm dark:border-night-line dark:bg-night-base" />
        </div>
        <button type="submit" disabled={!label.trim() || !target.trim() || create.isPending} className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-40">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrIcon className="h-4 w-4" />} Generate
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      <p className="mt-2 text-xs text-ink-subtle">
        The QR encodes a stable SOAR Hub link — you can change where it points anytime without reprinting.
      </p>
    </form>
  );
}

export function QrCodesPage() {
  const q = useQuery({ queryKey: ["qr-codes"], queryFn: listQrCodes, staleTime: 30_000 });
  const codes = q.data?.codes ?? [];

  return (
    <>
      <PageHeader
        title="QR Codes"
        description="Create a QR code, print or share it, then update where it points anytime — no reprinting."
      />

      <CreateForm />

      <div className="mt-6">
        {q.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-44 animate-pulse rounded-2xl bg-zinc-100 dark:bg-night-raised" />
            <div className="h-44 animate-pulse rounded-2xl bg-zinc-100 dark:bg-night-raised" />
          </div>
        ) : q.isError ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-4 py-6 text-sm text-ink-muted dark:border-night-line dark:bg-night-raised">
            Couldn’t load QR codes. Refresh to try again.
          </div>
        ) : codes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-4 py-10 text-center dark:border-night-line dark:bg-night-raised">
            <LinkIcon className="mx-auto h-7 w-7 text-zinc-300" />
            <p className="mt-2 text-sm font-medium text-ink dark:text-night-ink">No QR codes yet</p>
            <p className="mt-0.5 text-sm text-ink-muted">Generate your first one above.</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {codes.map((qr) => <QrCard key={qr.id} qr={qr} />)}
          </div>
        )}
      </div>
    </>
  );
}
