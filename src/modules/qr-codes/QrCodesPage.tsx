// QR Codes — a Flowcode-style dynamic QR generator for GM and above. Mint a
// code, customize how it looks (shape, colors, logo), print/share the QR, then
// repoint its destination anytime without reprinting. Reached from the
// Operations Tools hub (/operations).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  QrCode as QrIcon, Plus, Link as LinkIcon, Download, Copy, Check, Trash2, Power, ExternalLink, Loader2, Palette, ImagePlus, X, RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import {
  listQrCodes, createQrCode, updateQrCode, setQrActive, deleteQrCode, publicQrUrl, type QrCode, type QrStyle,
} from "./api";
import { StyledQr, downloadStyledQr, fileToLogoDataUrl } from "./StyledQr";

const DOT_OPTIONS: { v: NonNullable<QrStyle["dots"]>; label: string }[] = [
  { v: "square", label: "Square" },
  { v: "rounded", label: "Rounded" },
  { v: "dots", label: "Dots" },
  { v: "classy", label: "Classy" },
  { v: "extra-rounded", label: "Extra round" },
];
const CORNER_OPTIONS: { v: NonNullable<QrStyle["corners"]>; label: string }[] = [
  { v: "square", label: "Square" },
  { v: "extra-rounded", label: "Rounded" },
  { v: "dot", label: "Dot" },
];

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

// ── Style editor (one code) ─────────────────────────────────────────────────
function StyleEditor({
  style, setStyle, logo, setLogo,
}: {
  style: QrStyle; setStyle: (s: QrStyle) => void; logo: string | null; setLogo: (l: string | null) => void;
}) {
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const set = (patch: Partial<QrStyle>) => setStyle({ ...style, ...patch });
  const swatch = "h-8 w-8 cursor-pointer rounded-md border border-zinc-200 bg-transparent p-0 dark:border-night-line";

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-night-line dark:bg-night-base/40">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="font-semibold uppercase tracking-wide text-ink-subtle">Shape</span>
          <select value={style.shape || "square"} onChange={(e) => set({ shape: e.target.value as QrStyle["shape"] })} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-night-line dark:bg-night-base">
            <option value="square">Square</option>
            <option value="circle">Round</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="font-semibold uppercase tracking-wide text-ink-subtle">Dots</span>
          <select value={style.dots || "square"} onChange={(e) => set({ dots: e.target.value as QrStyle["dots"] })} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-night-line dark:bg-night-base">
            {DOT_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="font-semibold uppercase tracking-wide text-ink-subtle">Corners</span>
          <select value={style.corners || "square"} onChange={(e) => set({ corners: e.target.value as QrStyle["corners"] })} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-night-line dark:bg-night-base">
            {CORNER_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <div className="text-xs">
          <span className="font-semibold uppercase tracking-wide text-ink-subtle">Colors</span>
          <div className="mt-1 flex items-center gap-3">
            <label className="flex items-center gap-1.5" title="Foreground">
              <input type="color" value={style.fg || "#0a0a0a"} onChange={(e) => set({ fg: e.target.value })} className={swatch} />
              <span className="text-ink-muted">Dots</span>
            </label>
            <label className="flex items-center gap-1.5" title="Background">
              <input type="color" value={style.bg || "#ffffff"} onChange={(e) => set({ bg: e.target.value })} className={swatch} />
              <span className="text-ink-muted">Back</span>
            </label>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs font-medium text-ink-muted">
          <input type="checkbox" checked={!!style.gradient} onChange={(e) => set({ gradient: e.target.checked, fg2: style.fg2 || "#5b5bf0" })} />
          Gradient
        </label>
        {style.gradient && (
          <label className="flex items-center gap-1.5 text-xs" title="Gradient end color">
            <input type="color" value={style.fg2 || "#5b5bf0"} onChange={(e) => set({ fg2: e.target.value })} className={swatch} />
            <span className="text-ink-muted">End color</span>
          </label>
        )}

        {/* Logo */}
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:bg-zinc-50 dark:border-night-line">
            <ImagePlus className="h-3.5 w-3.5" /> {logo ? "Replace logo" : "Add logo"}
            <input
              type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setLogoErr(null);
                try { setLogo(await fileToLogoDataUrl(f)); } catch (err) { setLogoErr((err as Error).message); }
              }}
            />
          </label>
          {logo && (
            <button type="button" onClick={() => setLogo(null)} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs text-ink-muted hover:bg-zinc-50 dark:border-night-line">
              <X className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>
      </div>
      {logoErr && <p className="mt-1.5 text-xs text-red-600">{logoErr}</p>}

      {/* Caption frame — words around the QR */}
      <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-night-line">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            <span className="font-semibold uppercase tracking-wide text-ink-subtle">Frame</span>
            <select
              value={style.frame || "none"}
              onChange={(e) => {
                const frame = e.target.value as QrStyle["frame"];
                set(frame === "none" ? { frame } : { frame, frameText: style.frameText || "SCAN ME" });
              }}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-night-line dark:bg-night-base"
            >
              <option value="none">None</option>
              <option value="label">Caption bar</option>
              <option value="border">Framed border</option>
            </select>
          </label>

          {style.frame && style.frame !== "none" && (
            <>
              <label className="text-xs">
                <span className="font-semibold uppercase tracking-wide text-ink-subtle">Words</span>
                <input
                  value={style.frameText ?? ""}
                  onChange={(e) => set({ frameText: e.target.value })}
                  maxLength={40}
                  placeholder="SCAN ME"
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-night-line dark:bg-night-base"
                />
              </label>
              <label className="text-xs">
                <span className="font-semibold uppercase tracking-wide text-ink-subtle">Position</span>
                <select value={style.framePosition || "bottom"} onChange={(e) => set({ framePosition: e.target.value as QrStyle["framePosition"] })} className="mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-night-line dark:bg-night-base">
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </select>
              </label>
              <div className="text-xs">
                <span className="font-semibold uppercase tracking-wide text-ink-subtle">Frame colors</span>
                <div className="mt-1 flex items-center gap-3">
                  <label className="flex items-center gap-1.5" title="Bar / border color">
                    <input type="color" value={style.frameColor || style.fg || "#0a0a0a"} onChange={(e) => set({ frameColor: e.target.value })} className={swatch} />
                    <span className="text-ink-muted">Bar</span>
                  </label>
                  <label className="flex items-center gap-1.5" title="Caption text color">
                    <input type="color" value={style.frameTextColor || "#ffffff"} onChange={(e) => set({ frameTextColor: e.target.value })} className={swatch} />
                    <span className="text-ink-muted">Text</span>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── One QR card ─────────────────────────────────────────────────────────────
function QrCard({ qr }: { qr: QrCode }) {
  const qc = useQueryClient();
  const url = publicQrUrl(qr.code);
  const [label, setLabel] = useState(qr.label);
  const [target, setTarget] = useState(qr.target_url);
  const [style, setStyle] = useState<QrStyle>(qr.style || {});
  const [logo, setLogo] = useState<string | null>(qr.logo_url);
  const [showStyle, setShowStyle] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync from the row when it changes underneath us (e.g. after a refetch).
  useEffect(() => {
    setLabel(qr.label); setTarget(qr.target_url); setStyle(qr.style || {}); setLogo(qr.logo_url);
  }, [qr.label, qr.target_url, qr.style, qr.logo_url]);

  const dirty =
    label.trim() !== qr.label ||
    target.trim() !== qr.target_url ||
    JSON.stringify(style) !== JSON.stringify(qr.style || {}) ||
    (logo || null) !== (qr.logo_url || null);

  const save = useMutation({
    mutationFn: () => updateQrCode({ id: qr.id, label: label.trim(), target_url: target.trim(), style, logo_url: logo }),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ["qr-codes"] }); },
    onError: (e: Error) => setErr(e.message),
  });
  const toggle = useMutation({ mutationFn: () => setQrActive(qr.id, !qr.is_active), onSuccess: () => qc.invalidateQueries({ queryKey: ["qr-codes"] }) });
  const remove = useMutation({ mutationFn: () => deleteQrCode(qr.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["qr-codes"] }) });

  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-card dark:bg-night-raised ${qr.is_active ? "border-zinc-200 dark:border-night-line" : "border-dashed border-zinc-300 opacity-75 dark:border-night-line"}`}>
      <div className="flex gap-4">
        {/* Live preview */}
        <div className="shrink-0">
          <div className="rounded-xl border border-zinc-200 bg-white p-2 dark:border-night-line">
            <StyledQr value={url} style={style} logo={logo} size={120} />
          </div>
          <div className="mt-1.5 text-center font-mono text-[11px] text-ink-subtle">{qr.code}</div>
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${qr.is_active ? "bg-emerald-500/10 text-emerald-600" : "bg-zinc-200 text-zinc-500"}`}>
              {qr.is_active ? "Active" : "Off"}
            </span>
            <span className="text-[11px] text-ink-subtle">{qr.scan_count} scan{qr.scan_count === 1 ? "" : "s"}</span>
          </div>

          <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-0.5 w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-night-line dark:bg-night-base" />

          <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Points to</label>
          <div className="mt-0.5 flex gap-1.5">
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://…" className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-night-line dark:bg-night-base" />
            <a href={target} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-zinc-200 px-2 text-ink-muted hover:bg-zinc-50 dark:border-night-line" title="Open destination">
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>

      {/* Customize toggle + editor (full width below) */}
      <button type="button" onClick={() => setShowStyle((s) => !s)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
        <Palette className="h-3.5 w-3.5" /> {showStyle ? "Hide design" : "Customize design"}
      </button>
      {showStyle && <StyleEditor style={style} setStyle={setStyle} logo={logo} setLogo={setLogo} />}

      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save changes
        </button>
        <CopyButton text={url} />
        <button type="button" onClick={() => downloadStyledQr(url, style, logo, `qr-${qr.code}`)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:bg-zinc-50 dark:border-night-line">
          <Download className="h-3.5 w-3.5" /> PNG
        </button>
        <button type="button" onClick={() => toggle.mutate()} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:bg-zinc-50 dark:border-night-line">
          <Power className="h-3.5 w-3.5" /> {qr.is_active ? "Deactivate" : "Activate"}
        </button>
        <button type="button" onClick={() => { if (confirm(`Delete “${qr.label}”? The QR will stop working immediately.`)) remove.mutate(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/40">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
      {qr.created_by_name && <p className="mt-2 text-[11px] text-ink-subtle">Created by {qr.created_by_name}</p>}
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
    <form onSubmit={(e) => { e.preventDefault(); if (label.trim() && target.trim()) create.mutate(); }} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-card dark:border-night-line dark:bg-night-raised">
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
        The QR encodes a stable SOAR Hub link — change where it points or restyle it anytime, no reprinting. Customize the look after it’s created.
      </p>
    </form>
  );
}

export function QrCodesPage() {
  // Low stale time + refetch on focus so a scan's count shows when you come
  // back to this tab, without a hard reload.
  const q = useQuery({ queryKey: ["qr-codes"], queryFn: listQrCodes, staleTime: 3_000, refetchOnWindowFocus: true });
  const codes = q.data?.codes ?? [];

  return (
    <>
      <PageHeader title="QR Codes" description="Create a QR code, customize its look, then update where it points anytime — no reprinting." />

      <CreateForm />

      {codes.length > 0 && (
        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs text-ink-subtle">{codes.length} code{codes.length === 1 ? "" : "s"}</span>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:bg-zinc-50 disabled:opacity-50 dark:border-night-line"
            disabled={q.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh scans
          </button>
        </div>
      )}

      <div className="mt-3">
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
