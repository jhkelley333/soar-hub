// Vendor WhatsApp snippet modal. Given the selected work-order ids, fetches a
// ready-to-paste message (grouped by store, with each store's address + phone)
// and offers Copy + Open-in-WhatsApp. The text is editable before sending.
import { useEffect, useState } from "react";
import { Loader2, X, Copy, Check, MessageCircle } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { fetchVendorSnippet } from "./api";

export function VendorSnippetModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchVendorSnippet(ids)
      .then((r) => { if (!cancelled) setText(r.text || "No details found for the selected work orders."); })
      .catch((e: unknown) => { if (!cancelled) setError((e as Error)?.message || "Couldn't build the message."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ids]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can select + copy manually */ }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">
            Send to vendor · {ids.length} work order{ids.length === 1 ? "" : "s"}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight" aria-label="Close">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Building the message…
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">{error}</div>
          ) : (
            <>
              <p className="mb-2 text-[11px] text-zinc-500">
                Review and edit if you like, then copy or open WhatsApp to pick the vendor.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={14}
                className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-[12.5px] leading-relaxed text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="secondary" onClick={copy} disabled={loading || !!error || !text.trim()}>
            {copied ? <Check className="mr-1 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="primary"
            disabled={loading || !!error || !text.trim()}
            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener")}
          >
            <MessageCircle className="mr-1 h-3.5 w-3.5" /> Open WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
}
