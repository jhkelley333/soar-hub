// Linked (external) calendars panel for the Schedule rail. Add a calendar by
// its iCal URL and scope it — just you, your whole market, or the company.
// Inherited calendars can be hidden for just you or muted for your market.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Copy, Eye, EyeOff, Link2, Loader2, Plus, Smartphone, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Modal } from "@/shared/ui/Modal";
import { useToast } from "@/shared/ui/Toaster";
import { fetchCalendars, fetchFeedToken, linkCalendar, muteCalendar, rotateFeedToken, unlinkCalendar, unmuteCalendar, updateCalendar } from "./api";
import { CAL_COLOR_OPTIONS, type CalColor, type CalScope, type YouMarker } from "./types";

const MARKET_NAME: Record<string, string> = { store: "Store", district: "District", area: "Area", region: "Region" };
type MuteScope = "user" | "store" | "district" | "area" | "region" | "org";

export function LinkedCalendars({ you, canOrgWide }: { you?: YouMarker; canOrgWide: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const calsQ = useQuery({ queryKey: ["schedule-calendars"], queryFn: fetchCalendars });
  const cals = calsQ.data?.calendars ?? [];

  // The user's own market node (store/district/area/region) — drives the
  // "My …" add-scope and the market-mute target.
  const market = you && you.scope_type && you.scope_type !== "org" ? (you.scope_type as CalScope) : null;
  const marketName = market ? MARKET_NAME[market] : "";

  const [adding, setAdding] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState<CalColor>("blue");
  const [scope, setScope] = useState<CalScope>("personal");

  function refresh() {
    qc.invalidateQueries({ queryKey: ["schedule-calendars"] });
    qc.invalidateQueries({ queryKey: ["schedule-events"] });
  }

  const addMut = useMutation({
    mutationFn: () =>
      linkCalendar({
        label: label.trim(), url: url.trim(), color,
        scope_type: scope,
        scope_id: scope === market ? you?.scope_id ?? null : null,
      }),
    onSuccess: () => {
      toast.push("Calendar linked.", "success");
      setAdding(false); setLabel(""); setUrl(""); setColor("blue"); setScope("personal");
      refresh();
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't link.", "error"),
  });
  const colorMut = useMutation({ mutationFn: (v: { id: string; color: CalColor }) => updateCalendar(v), onSuccess: refresh });
  const delMut = useMutation({
    mutationFn: (id: string) => unlinkCalendar(id),
    onSuccess: () => { toast.push("Calendar removed.", "success"); refresh(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Remove failed.", "error"),
  });
  const muteMut = useMutation({
    mutationFn: (v: { id: string; on: boolean; scope_type: MuteScope; scope_id?: string | null }) =>
      v.on ? muteCalendar({ id: v.id, scope_type: v.scope_type, scope_id: v.scope_id })
           : unmuteCalendar({ id: v.id, scope_type: v.scope_type, scope_id: v.scope_id }),
    onSuccess: refresh,
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Update failed.", "error"),
  });

  const scopeOptions: { value: CalScope; label: string }[] = [{ value: "personal", label: "Just me" }];
  if (market) scopeOptions.push({ value: market, label: `My ${marketName}` });
  if (canOrgWide) scopeOptions.push({ value: "org", label: "Company (everyone)" });

  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Linked calendars</span>
        <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:underline">
          <Plus className="h-3 w-3" /> Link
        </button>
      </div>

      {calsQ.isLoading ? (
        <div className="px-1 py-1 text-xs text-zinc-400">Loading…</div>
      ) : cals.length === 0 && !adding ? (
        <button
          onClick={() => setAdding(true)}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-200 px-2 py-1.5 text-left text-xs text-zinc-500 hover:border-accent hover:text-zinc-700"
        >
          <Link2 className="h-3.5 w-3.5" /> Add a Google / Apple / Outlook calendar
        </button>
      ) : (
        <ul className="space-y-0.5">
          {cals.map((c) => {
            const dot = CAL_COLOR_OPTIONS.find((o) => o.value === c.color)?.dot ?? "bg-blue-500";
            const shared = c.scope_type !== "personal";
            const dim = c.muted_for_me || c.muted_for_market;
            return (
              <li key={c.id} className={cn("group flex items-center gap-1.5 rounded-md py-1 pr-1 hover:bg-zinc-100", dim && "opacity-50")}>
                {/* Color dot — for managers, an invisible native select overlays
                    it so tapping opens a color menu without showing its text. */}
                <span className="relative inline-flex h-3 w-3 shrink-0 items-center justify-center">
                  <span className={cn("h-3 w-3 rounded-full", dot)} />
                  {c.can_manage && (
                    <select
                      value={c.color}
                      onChange={(e) => colorMut.mutate({ id: c.id, color: e.target.value as CalColor })}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      title="Change color"
                      aria-label="Calendar color"
                    >
                      {CAL_COLOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
                    </select>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-700" title={c.url}>{c.label}</span>
                {shared && (
                  <span className="shrink-0 rounded bg-zinc-200/70 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                    {c.scope_label}
                  </span>
                )}
                {c.last_error && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={`Sync error: ${c.last_error}`} />}

                {/* Market mute — leaders can hide an inherited calendar for their whole market. */}
                {shared && market && (
                  <button
                    onClick={() => muteMut.mutate({ id: c.id, on: !c.muted_for_market, scope_type: market as MuteScope, scope_id: you?.scope_id })}
                    className={cn("shrink-0 rounded p-0.5", c.muted_for_market ? "text-rose-500" : "text-zinc-300 hover:text-zinc-600")}
                    title={c.muted_for_market ? `Hidden for your ${marketName} — click to show` : `Hide for your whole ${marketName}`}
                  >
                    <Building2 className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Personal show/hide. */}
                <button
                  onClick={() => muteMut.mutate({ id: c.id, on: !c.muted_for_me, scope_type: "user" })}
                  className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-700"
                  title={c.muted_for_me ? "Show (hidden for you)" : "Hide for you"}
                >
                  {c.muted_for_me ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>

                {c.can_manage && (
                  <button
                    onClick={() => { if (window.confirm(`Remove "${c.label}"${shared ? " for everyone" : ""}?`)) delMut.mutate(c.id); }}
                    className="shrink-0 rounded p-0.5 text-zinc-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <div className="mt-2 space-y-2 rounded-md border border-zinc-200 bg-white p-2.5">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name (e.g. My Google calendar)"
            className="block w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="iCal URL (https:// … .ics)"
            className="block w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {scopeOptions.length > 1 && (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Who sees it</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as CalScope)}
                className="mt-0.5 block w-full rounded-md border border-zinc-200 px-2 py-1.5 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {scopeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          <div className="flex items-center gap-1.5">
            {CAL_COLOR_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setColor(o.value)}
                className={cn("h-5 w-5 rounded-full ring-offset-1", o.dot, color === o.value ? "ring-2 ring-zinc-700" : "ring-0")}
                title={o.value}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={() => {
                if (!label.trim()) { toast.push("Name the calendar.", "error"); return; }
                if (!/^(https?:\/\/|webcal:\/\/)/i.test(url.trim())) { toast.push("Enter a valid iCal URL.", "error"); return; }
                addMut.mutate();
              }}
              disabled={addMut.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {addMut.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Link calendar
            </button>
            <button onClick={() => setAdding(false)} className="text-xs font-medium text-zinc-500 hover:text-zinc-700">Cancel</button>
          </div>
          <p className="text-[10px] leading-snug text-zinc-400">
            In Google Calendar: Settings → your calendar → “Secret address in iCal format”. Paste that URL here.
          </p>
        </div>
      )}

      <button
        onClick={() => setSubOpen(true)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
      >
        <Smartphone className="h-3.5 w-3.5" /> Subscribe on your phone
      </button>
      <SubscribeModal open={subOpen} onClose={() => setSubOpen(false)} />
    </div>
  );
}

// "Subscribe on your phone" — shows the user's private .ics URL with copy +
// an Apple/iOS one-tap (webcal://) and a way to regenerate the link.
function SubscribeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const tokenQ = useQuery({ queryKey: ["schedule-feed-token"], queryFn: fetchFeedToken, enabled: open });
  const token = tokenQ.data?.token;

  const httpsUrl = token ? `${window.location.origin}/.netlify/functions/schedule?action=ics&token=${token}` : "";
  const webcalUrl = httpsUrl.replace(/^https?:/i, "webcal:");

  const rotateMut = useMutation({
    mutationFn: rotateFeedToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule-feed-token"] });
      toast.push("New link generated — update it on your devices.", "success");
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't regenerate.", "error"),
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.push("Copy failed — select and copy the link.", "error");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Subscribe to your SOAR calendar" maxWidth="max-w-md">
      <div className="space-y-4 text-sm">
        <p className="text-zinc-600">
          Add your SOAR schedule to your phone’s calendar. It stays in sync automatically and is read-only.
          Keep this link private — anyone with it can see your calendar.
        </p>

        {tokenQ.isLoading ? (
          <div className="flex items-center gap-2 text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Preparing your link…</div>
        ) : (
          <>
            <div>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Your subscribe link</div>
              <div className="flex items-center gap-2">
                <input readOnly value={httpsUrl} onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-700" />
                <button onClick={copy} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-midnight px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-midnight/90">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <a href={webcalUrl} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent/90">
              <Smartphone className="h-4 w-4" /> Add to Apple / iPhone Calendar
            </a>

            <div className="rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600">
              <div className="font-semibold text-zinc-700">How to add it</div>
              <p className="mt-1"><span className="font-medium">iPhone / Mac:</span> tap “Add to Apple Calendar” above, then confirm.</p>
              <p className="mt-1"><span className="font-medium">Google Calendar:</span> on a computer, go to Other calendars → <span className="font-medium">From URL</span>, and paste the link.</p>
              <p className="mt-1"><span className="font-medium">Outlook:</span> Add calendar → Subscribe from web, paste the link.</p>
            </div>

            <button
              onClick={() => { if (window.confirm("Generate a new link? Your current subscription links will stop working until you update them.")) rotateMut.mutate(); }}
              disabled={rotateMut.isPending}
              className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
            >
              {rotateMut.isPending ? "Regenerating…" : "Regenerate link (revoke the old one)"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
