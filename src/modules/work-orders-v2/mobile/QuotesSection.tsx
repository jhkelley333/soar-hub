// Quotes block for the WO Approval card. Lists each vendor quote
// (vendor + total + attached file), lets an internal user add one
// (vendor name + total + required file), mark one recommended, or
// remove it. Vendor-submitted quotes (source === "vendor") show a chip.
//
// The recommended quote drives the ticket's committed cost (kept in sync
// server-side), so the approver compares totals and picks a winner.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Paperclip, Trash2, Check, Star, Loader2, Send, Sparkles, Copy } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Drawer } from "@/shared/ui/Drawer";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { addQuote, deleteQuote, extractQuote, setRecommendedQuote, fileToBase64 } from "../api";
import type { Ticket, WorkOrderQuote } from "../types";
import { formatDollars } from "./woMobile";

export function QuotesSection({
  ticket,
  onChanged,
}: {
  ticket: Ticket;
  onChanged: () => void;
}) {
  const toast = useToast();
  const quotes = [...(ticket.ticket_quotes ?? [])].sort((a, b) => {
    if (a.is_recommended !== b.is_recommended) return a.is_recommended ? -1 : 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const [addOpen, setAddOpen] = useState(false);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [request, setRequest] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // AI auto-fill from the quote document — same pattern as Order Parts /
  // Order Replacement's receipt scan.
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [scanFilled, setScanFilled] = useState(false);

  async function onFilePicked(picked: File | null) {
    setFile(picked);
    setScanFilled(false);
    setScanNote(null);
    if (!picked) return;
    setScanning(true);
    try {
      const data = await fileToBase64(picked);
      const { extracted: ex } = await extractQuote({ data, type: picked.type || "application/octet-stream" });
      let filled = false;
      const fill = (cond: boolean, set: () => void) => { if (cond) { set(); filled = true; } };
      fill(!vendor.trim() && !!ex.vendor_name, () => setVendor(ex.vendor_name));
      fill(!amount.trim() && ex.amount != null, () => setAmount(String(ex.amount)));
      fill(!request.trim() && !!ex.work_description, () => setRequest(ex.work_description));
      fill(!note.trim() && !!ex.note, () => setNote(ex.note));
      setScanFilled(filled);
      if (!filled) setScanNote("Couldn't pull anything new from that quote — fill in what's needed.");
    } catch (e) {
      setScanNote(e instanceof Error ? e.message : "Couldn't read the quote — enter the details manually.");
    } finally {
      setScanning(false);
    }
  }

  const add = useMutation({
    mutationFn: async () => {
      const cents = Math.round(parseFloat(amount) * 100);
      if (!vendor.trim()) throw new Error("Vendor name is required.");
      if (!Number.isFinite(cents) || cents <= 0) throw new Error("Enter a valid total.");
      if (!request.trim()) throw new Error("Add a short Request — what work is this for?");
      if (!file) throw new Error("Attach the quote document.");
      const fileData = await fileToBase64(file);
      return addQuote({
        ticketId: ticket.id,
        vendorName: vendor.trim(),
        amountCents: cents,
        workRequested: request.trim(),
        note: note.trim() || undefined,
        fileData,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
      });
    },
    onSuccess: () => {
      toast.push("Quote added.", "success");
      setAddOpen(false);
      setVendor(""); setAmount(""); setRequest(""); setNote(""); setFile(null);
      setScanning(false); setScanNote(null); setScanFilled(false);
      onChanged();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Couldn't add quote.", "error"),
  });

  const recommend = useMutation({
    mutationFn: (quoteId: string) => setRecommendedQuote(ticket.id, quoteId),
    onSuccess: () => { toast.push("Recommended quote set.", "success"); onChanged(); },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  const remove = useMutation({
    mutationFn: (quoteId: string) => deleteQuote(quoteId),
    onSuccess: () => { toast.push("Quote removed.", "success"); onChanged(); },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  const busy = recommend.isPending || remove.isPending;

  // Cheapest → priciest, for the compare strip and the copy-paste summary —
  // deliberately separate from `quotes`' on-screen order (recommended
  // first), since comparing is about price, not who's currently winning.
  const byPrice = [...quotes].sort((a, b) => a.amount_cents - b.amount_cents);
  const cheapest = byPrice[0];
  const priciest = byPrice[byPrice.length - 1];
  const spreadCents = byPrice.length > 1 ? priciest.amount_cents - cheapest.amount_cents : 0;

  const [copied, setCopied] = useState(false);
  async function copySummary() {
    const lines = [
      `Quotes — ${ticket.wo_number}${ticket.store_number ? ` (#${ticket.store_number}${ticket.store_name ? ` ${ticket.store_name}` : ""})` : ""}`,
      ...(ticket.work_requested ? [ticket.work_requested] : []),
      "",
      ...byPrice.map((q, i) => `${i + 1}. ${q.vendor_name || "Vendor"} — ${formatDollars(q.amount_cents / 100)}${q.is_recommended ? " ⭐ Recommended" : ""}`),
      ...(byPrice.length > 1
        ? ["", `Lowest: ${cheapest.vendor_name || "Vendor"} (${formatDollars(cheapest.amount_cents / 100)})`, ...(spreadCents > 0 ? [`Spread: ${formatDollars(spreadCents / 100)}`] : [])]
        : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      toast.push("Copied — paste into WhatsApp.", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.push("Couldn't copy to clipboard.", "error");
    }
  }

  return (
    <section>
      <div className="px-2 pb-1.5 pt-1 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-midnight-500">
          Quotes{quotes.length > 1 ? ` · ${quotes.length}` : ""}
        </span>
        <div className="flex items-center gap-3">
          {quotes.length > 0 && (
            <button
              type="button"
              onClick={copySummary}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-midnight-600 hover:text-accent"
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
              {copied ? "Copied!" : "Copy summary"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Add quote
          </button>
        </div>
      </div>

      {quotes.length > 1 && (
        <div className="mx-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-emerald-50 px-3 py-2 text-[11.5px] text-emerald-800">
          <span>Lowest: <strong>{cheapest.vendor_name || "Vendor"}</strong> ({formatDollars(cheapest.amount_cents / 100)})</span>
          {spreadCents > 0 && <span>Spread: {formatDollars(spreadCents / 100)}</span>}
        </div>
      )}

      {quotes.length === 0 ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-midnight-200 bg-surface px-4 py-4 text-[13px] font-medium text-midnight-500 hover:border-accent hover:text-midnight-800"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Add the first quote
        </button>
      ) : (
        <div className="space-y-2">
          {quotes.map((qz) => (
            <QuoteCard
              key={qz.id}
              quote={qz}
              busy={busy}
              onRecommend={() => recommend.mutate(qz.id)}
              onRemove={() => remove.mutate(qz.id)}
            />
          ))}
        </div>
      )}

      <Drawer
        open={addOpen}
        onClose={() => { if (!add.isPending) setAddOpen(false); }}
        title="Add a quote"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={add.isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => add.mutate()} disabled={add.isPending}>
              {add.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" strokeWidth={2} />}
              Add quote
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="q-vendor">Vendor *</Label>
            <Input
              id="q-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. Penguin Refrigeration"
            />
          </div>
          <div>
            <Label htmlFor="q-amount">Total *</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">$</span>
              <Input
                id="q-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="pl-5"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="q-request">Request * (what work?)</Label>
            <Input
              id="q-request"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="e.g. Replaced motor and belt"
            />
          </div>
          <div>
            <Label>Quote document * (auto-fills the fields above)</Label>
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-600 hover:border-accent hover:bg-accent/5">
              <Paperclip className="h-4 w-4" strokeWidth={1.75} />
              {file ? file.name : "Attach PDF or image"}
              <input
                type="file"
                accept="image/*,.pdf,application/pdf"
                className="hidden"
                onChange={(e) => onFilePicked(e.target.files?.[0] || null)}
              />
            </label>
            {scanning && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading the quote…
              </div>
            )}
            {!scanning && scanFilled && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-700">
                <Sparkles className="h-3 w-3" /> Auto-filled from the quote — please review.
              </div>
            )}
            {!scanning && scanNote && (
              <div className="mt-1.5 text-[11px] text-amber-700">{scanNote}</div>
            )}
          </div>
          <div>
            <Label htmlFor="q-note">Justification</Label>
            <textarea
              id="q-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Brief description of the work — the approver can open the quote for full detail."
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>
      </Drawer>
    </section>
  );
}

function QuoteCard({
  quote,
  busy,
  onRecommend,
  onRemove,
}: {
  quote: WorkOrderQuote;
  busy: boolean;
  onRecommend: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl bg-surface p-3.5 shadow-card ring-1",
        quote.is_recommended ? "ring-accent" : "ring-midnight-100",
      )}
    >
      {quote.is_recommended && (
        <span className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
          <Star className="h-3 w-3 fill-current" strokeWidth={2} />
          Recommended
        </span>
      )}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-midnight-900 truncate">
              {quote.vendor_name || "Vendor"}
            </span>
            {quote.source === "vendor" && (
              <span className="rounded-full bg-frost-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-midnight-600">
                Vendor
              </span>
            )}
          </div>
          {quote.note && (
            <div className="mt-0.5 text-[12px] text-midnight-500 line-clamp-2">{quote.note}</div>
          )}
          <div className="mt-1.5 flex items-center gap-3">
            {quote.file_url && (
              <a
                href={quote.file_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
              >
                <Paperclip className="h-3.5 w-3.5" strokeWidth={2} />
                View quote
              </a>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[16px] font-semibold text-midnight-900 tabular-nums">
            {formatDollars(quote.amount_cents / 100)}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-midnight-100 pt-2.5">
        {!quote.is_recommended && (
          <button
            type="button"
            onClick={onRecommend}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-midnight-600 hover:text-accent disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            Make recommended
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-midnight-400 hover:text-cherry disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          Remove
        </button>
      </div>
    </div>
  );
}
