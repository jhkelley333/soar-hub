// Destination editor — the kind tabs (URL / Email / Call / SMS) plus the
// fields for the selected kind. Shared by the create form and each code's
// inline editor so they behave identically.
import { Link2, Mail, Phone, MessageSquare, type LucideIcon } from "lucide-react";
import type { QrKind, QrPayload } from "./api";

const KINDS: { k: QrKind; label: string; icon: LucideIcon }[] = [
  { k: "url", label: "URL", icon: Link2 },
  { k: "email", label: "Email", icon: Mail },
  { k: "call", label: "Call", icon: Phone },
  { k: "sms", label: "SMS", icon: MessageSquare },
];

const inputCls = "w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-night-line dark:bg-night-base";

export function DestinationEditor({
  kind, setKind, payload, setPayload,
}: {
  kind: QrKind; setKind: (k: QrKind) => void; payload: QrPayload; setPayload: (p: QrPayload) => void;
}) {
  const set = (patch: Partial<QrPayload>) => setPayload({ ...payload, ...patch });

  return (
    <div>
      {/* Kind tabs */}
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
              kind === k
                ? "border-accent bg-accent/10 text-accent"
                : "border-zinc-200 text-ink-muted hover:bg-zinc-50 dark:border-night-line"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Fields for the selected kind */}
      <div className="mt-2 space-y-2">
        {kind === "url" && (
          <input value={payload.url || ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/menu" className={inputCls} />
        )}
        {kind === "email" && (
          <>
            <input value={payload.email || ""} onChange={(e) => set({ email: e.target.value })} placeholder="hiring@store.com" className={inputCls} />
            <input value={payload.subject || ""} onChange={(e) => set({ subject: e.target.value })} placeholder="Subject (optional)" className={inputCls} />
            <textarea value={payload.body || ""} onChange={(e) => set({ body: e.target.value })} placeholder="Pre-filled message (optional)" rows={2} className={inputCls} />
          </>
        )}
        {kind === "call" && (
          <input value={payload.phone || ""} onChange={(e) => set({ phone: e.target.value })} placeholder="+1 (555) 123-4567" inputMode="tel" className={inputCls} />
        )}
        {kind === "sms" && (
          <>
            <input value={payload.phone || ""} onChange={(e) => set({ phone: e.target.value })} placeholder="+1 (555) 123-4567" inputMode="tel" className={inputCls} />
            <textarea value={payload.body || ""} onChange={(e) => set({ body: e.target.value })} placeholder="Pre-filled text (optional)" rows={2} className={inputCls} />
          </>
        )}
      </div>
    </div>
  );
}
