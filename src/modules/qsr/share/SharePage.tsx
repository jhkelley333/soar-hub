// SOAR QSR — Share / QR codes. Admin mints one durable access token per store;
// the QR/link opens the no-login player (/learn/:token). Print or post the QR
// at the store; crew scan, pick their name, and take courses. Admin-only.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { ArrowLeft, Check, Copy, Loader2, QrCode, Trash2 } from "lucide-react";
import { useToast } from "@/shared/ui/Toaster";
import { fetchAccessTokens, mintAccessToken, revokeAccessToken, fetchAssignTargets } from "../api";

const learnUrl = (token: string) => `${window.location.origin}/learn/${token}`;

function QrThumb({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(url, { width: 220, margin: 1 }).then(setSrc).catch(() => setSrc("")); }, [url]);
  return src ? <img src={src} alt="QR code" className="h-40 w-40 rounded-lg border border-border bg-white p-1" /> : <div className="h-40 w-40 animate-pulse rounded-lg bg-surface-sunk" />;
}

export function SharePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const tokensQ = useQuery({ queryKey: ["qsr", "tokens"], queryFn: fetchAccessTokens });
  const targetsQ = useQuery({ queryKey: ["qsr", "manage", "targets"], queryFn: fetchAssignTargets });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["qsr", "tokens"] });

  const [storeId, setStoreId] = useState("");
  const [copied, setCopied] = useState("");
  const [qrFor, setQrFor] = useState("");

  const mint = useMutation({
    mutationFn: () => mintAccessToken(storeId),
    onSuccess: () => { toast.push("Store code ready.", "success"); setStoreId(""); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeAccessToken(id),
    onSuccess: () => { toast.push("Code revoked.", "success"); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  const copy = (token: string) => {
    navigator.clipboard.writeText(learnUrl(token)).then(() => { setCopied(token); setTimeout(() => setCopied(""), 1500); });
  };

  const active = (tokensQ.data?.tokens ?? []).filter((t) => t.is_active && !t.revoked_at);
  const usedStoreIds = new Set(active.map((t) => t.store_id));
  const availableStores = (targetsQ.data?.stores ?? []).filter((s) => !usedStoreIds.has(s.id));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/qsr" className="inline-flex items-center gap-1.5 font-qsr-ui text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Soar MyLearning
      </Link>

      <div className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-qsr-azure" />
        <h1 className="font-qsr-display text-2xl font-bold text-ink">Share codes</h1>
      </div>
      <p className="-mt-3 max-w-2xl font-qsr-ui text-sm text-ink-muted">
        One QR per store. Post it in the store — crew scan it, tap their name, and take courses with no login. Completion shows up in the Manager dashboard.
      </p>

      {/* Mint */}
      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-4">
        <label className="flex-1">
          <span className="mb-1 block font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Create a code for a store</span>
          <select className="block w-full rounded-lg border border-border bg-surface px-3 py-2 font-qsr-ui text-sm text-ink focus:border-qsr-azure focus:outline-none" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Choose a store…</option>
            {availableStores.map((s) => <option key={s.id} value={s.id}>{s.number} — {s.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => mint.mutate()} disabled={!storeId || mint.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-qsr-azure px-3 py-2 font-qsr-ui text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40">
          {mint.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} Generate
        </button>
      </div>

      {/* Active codes */}
      <div className="space-y-3">
        {tokensQ.isLoading ? <div className="h-20 animate-pulse rounded-2xl bg-surface-sunk" /> :
          active.length === 0 ? <p className="font-qsr-ui text-sm text-ink-muted">No store codes yet — create one above.</p> :
          active.map((t) => (
            <div key={t.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-qsr-display text-base font-semibold text-ink">{t.store ? `${t.store.number} — ${t.store.name}` : "Store"}</div>
                  <div className="mt-1 truncate font-qsr-mono text-[11px] text-ink-muted">{learnUrl(t.token)}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => copy(t.token)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-qsr-ui text-xs font-semibold text-ink hover:border-qsr-azure">
                      {copied === t.token ? <><Check className="h-3.5 w-3.5 text-success" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy link</>}
                    </button>
                    <button type="button" onClick={() => setQrFor(qrFor === t.token ? "" : t.token)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-qsr-ui text-xs font-semibold text-ink hover:border-qsr-azure">
                      <QrCode className="h-3.5 w-3.5" /> {qrFor === t.token ? "Hide QR" : "Show QR"}
                    </button>
                    <button type="button" onClick={() => { if (confirm("Revoke this store's code? The QR will stop working.")) revoke.mutate(t.id); }} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-qsr-ui text-xs font-semibold text-ink hover:border-qsr-crimson hover:text-qsr-crimson">
                      <Trash2 className="h-3.5 w-3.5" /> Revoke
                    </button>
                  </div>
                </div>
              </div>
              {qrFor === t.token && (
                <div className="mt-3 flex flex-col items-center gap-2 border-t border-border pt-3">
                  <QrThumb url={learnUrl(t.token)} />
                  <p className="font-qsr-ui text-[11px] text-ink-subtle">Print and post at {t.store ? t.store.name : "the store"}.</p>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
