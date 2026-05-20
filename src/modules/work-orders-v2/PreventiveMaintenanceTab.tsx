// PM admin tab — manage templates and per-store schedules. Admin only.
// Lives inside the WO2 Settings panel. Manual "Spawn due now" button
// runs the same logic the daily Netlify cron uses, so admins can test
// without waiting overnight.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  Edit3,
  ExternalLink,
  Loader2,
  PlayCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { fetchCallerStores, fetchVendors } from "./api";
import {
  deletePmSchedule,
  deletePmTemplate,
  listPmSchedules,
  listPmTemplates,
  patchPmSchedule,
  spawnDuePmsNow,
  upsertPmSchedule,
  upsertPmTemplate,
  type PmSchedule,
  type PmTemplate,
  type UpsertTemplateBody,
} from "./pmApi";

type SubTab = "templates" | "schedules";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysFromNow(s: string | null): number | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86_400_000);
}

function cadenceLabel(t: PmTemplate): string {
  if (t.cadence_type === "rolling") {
    const n = t.cadence_days || 0;
    if (n % 365 === 0) return `Every ${n / 365}y`;
    if (n % 30 === 0) return `Every ${n / 30}mo`;
    if (n % 7 === 0) return `Every ${n / 7}wk`;
    return `Every ${n}d`;
  }
  const months = (t.fixed_months || []).map((m) => MONTH_LABELS[m - 1] || m).join(", ");
  return `${months} · day ${t.fixed_day_of_month || 1}`;
}

export function PreventiveMaintenanceTab() {
  const { profile } = useAuth();
  const isAdmin = (profile?.role || "").toLowerCase() === "admin";
  const [sub, setSub] = useState<SubTab>("templates");

  if (!isAdmin) {
    return (
      <EmptyState
        title="Admin only"
        description="Preventive maintenance management is restricted to admins. Ask an admin if you need a PM scheduled."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex border-b border-zinc-200">
        {(["templates", "schedules"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSub(s)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium tracking-tight transition",
              sub === s
                ? "border-accent text-midnight"
                : "border-transparent text-zinc-500 hover:text-midnight",
            )}
          >
            {s === "templates" ? "Templates" : "Schedules"}
          </button>
        ))}
      </div>
      {sub === "templates" ? <TemplatesView /> : <SchedulesView />}
    </div>
  );
}

// ── Templates view ────────────────────────────────────────────────

function TemplatesView() {
  const toast = useToast();
  const qc = useQueryClient();
  const templatesQ = useQuery({ queryKey: ["pm-templates"], queryFn: listPmTemplates });
  const [editing, setEditing] = useState<PmTemplate | "new" | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => deletePmTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-templates"] });
      qc.invalidateQueries({ queryKey: ["pm-schedules"] });
      toast.push("Template deleted.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Delete failed.", "error"),
  });

  const templates = templatesQ.data?.templates || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-600">
          Define the work that needs to happen and how often.
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
          New template
        </Button>
      </div>

      {templatesQ.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {templatesQ.isError && (
        <EmptyState
          title="Couldn't load templates"
          description={(templatesQ.error as Error)?.message || "Try again."}
        />
      )}
      {!templatesQ.isLoading && templates.length === 0 && (
        <EmptyState
          title="No PM templates yet"
          description='Create one — e.g. "Quarterly hood cleaning" with a vendor and 90-day rolling cadence.'
        />
      )}

      <div className="space-y-2">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardBody className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tracking-tight text-midnight">{t.name}</span>
                    <Badge tone={t.performer_type === "vendor" ? "info" : "warning"}>
                      {t.performer_type === "vendor" ? "Vendor" : "Internal"}
                    </Badge>
                    {!t.is_active && <Badge tone="neutral">Inactive</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" strokeWidth={1.75} />
                      {cadenceLabel(t)}
                    </span>
                    <span>Lead: {t.lead_days}d</span>
                    {t.category && <span>· {t.category}</span>}
                    {t.performer_type === "vendor" && t.vendors && (
                      <span>· Vendor: <span className="font-medium text-midnight">{t.vendors.name}</span></span>
                    )}
                    {t.est_cost != null && t.est_cost !== "" && (
                      <span>· Est ${Number(t.est_cost).toFixed(2)}</span>
                    )}
                  </div>
                  {t.description && (
                    <div className="mt-1 text-xs text-zinc-500">{t.description}</div>
                  )}
                  {t.checklist_url && (
                    <a
                      href={t.checklist_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      Checklist <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-midnight"
                    title="Edit"
                  >
                    <Edit3 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete template "${t.name}"? This also removes all schedule rows that reference it.`)) {
                        del.mutate(t.id);
                      }
                    }}
                    className="rounded-md p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {editing && (
        <TemplateModal
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["pm-templates"] });
          }}
        />
      )}
    </div>
  );
}

interface TemplateModalProps {
  initial: PmTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateModal({ initial, onClose, onSaved }: TemplateModalProps) {
  const toast = useToast();
  const vendorsQ = useQuery({
    queryKey: ["pm-vendors-picker"],
    queryFn: () => fetchVendors(),
  });

  const [form, setForm] = useState<UpsertTemplateBody>(() => ({
    id: initial?.id,
    name: initial?.name || "",
    category: initial?.category || "",
    description: initial?.description || "",
    instructions: initial?.instructions || "",
    performer_type: initial?.performer_type || "vendor",
    default_vendor_id: initial?.default_vendor_id || null,
    cadence_type: initial?.cadence_type || "rolling",
    cadence_days: initial?.cadence_days ?? 90,
    fixed_months: initial?.fixed_months || [1, 4, 7, 10],
    fixed_day_of_month: initial?.fixed_day_of_month ?? 15,
    lead_days: initial?.lead_days ?? 7,
    est_cost: initial?.est_cost ?? "",
    checklist_url: initial?.checklist_url || "",
    priority: initial?.priority || "Standard",
    is_active: initial?.is_active ?? true,
  }));

  const save = useMutation({
    mutationFn: () => upsertPmTemplate(form),
    onSuccess: () => {
      toast.push("Template saved.", "success");
      onSaved();
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  const toggleMonth = (m: number) => {
    const cur = form.fixed_months || [];
    setForm({
      ...form,
      fixed_months: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="my-8 w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">
            {initial ? "Edit PM Template" : "New PM Template"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="pm-name">Name</Label>
            <Input
              id="pm-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Quarterly hood cleaning"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pm-cat">Category</Label>
              <Input
                id="pm-cat"
                value={form.category || ""}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="HVAC, Hood, Fire, ..."
              />
            </div>
            <div>
              <Label htmlFor="pm-priority">Priority</Label>
              <select
                id="pm-priority"
                value={form.priority || "Standard"}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {["Standard", "Planned", "Urgent", "Emergency"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="pm-desc">Description</Label>
            <textarea
              id="pm-desc"
              value={form.description || ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Short summary that shows on the ticket."
            />
          </div>
          <div>
            <Label htmlFor="pm-instructions">Instructions for the performer</Label>
            <textarea
              id="pm-instructions"
              value={form.instructions || ""}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              rows={3}
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Step-by-step or notes the vendor/internal staff should see."
            />
          </div>

          <div>
            <Label>Performer</Label>
            <div className="flex gap-2">
              {(["vendor", "internal"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setForm({ ...form, performer_type: p })}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition",
                    form.performer_type === p
                      ? "border-accent bg-accent/10 text-midnight"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
                  )}
                >
                  {p === "vendor" ? "Vendor" : "Internal team"}
                </button>
              ))}
            </div>
          </div>

          {form.performer_type === "vendor" && (
            <div>
              <Label htmlFor="pm-vendor">Default vendor</Label>
              <select
                id="pm-vendor"
                value={form.default_vendor_id || ""}
                onChange={(e) => setForm({ ...form, default_vendor_id: e.target.value || null })}
                className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">— Pick a vendor —</option>
                {(vendorsQ.data?.vendors || []).map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.category ? ` · ${v.category}` : ""}</option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-zinc-500">
                Each store schedule can override this with its own vendor.
              </div>
            </div>
          )}

          {form.performer_type === "internal" && (
            <div>
              <Label htmlFor="pm-checklist">Checklist URL</Label>
              <Input
                id="pm-checklist"
                value={form.checklist_url || ""}
                onChange={(e) => setForm({ ...form, checklist_url: e.target.value })}
                placeholder="https://docs.google.com/..."
              />
              <div className="mt-1 text-[11px] text-zinc-500">
                Link to the form internal staff fills out and uploads back to the ticket.
              </div>
            </div>
          )}

          <div>
            <Label>Cadence</Label>
            <div className="flex gap-2">
              {(["rolling", "fixed"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, cadence_type: c })}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition",
                    form.cadence_type === c
                      ? "border-accent bg-accent/10 text-midnight"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
                  )}
                >
                  {c === "rolling" ? "Rolling interval" : "Fixed calendar"}
                </button>
              ))}
            </div>
          </div>

          {form.cadence_type === "rolling" ? (
            <div>
              <Label htmlFor="pm-days">Every N days</Label>
              <Input
                id="pm-days"
                type="number"
                min={1}
                value={form.cadence_days ?? 90}
                onChange={(e) => setForm({ ...form, cadence_days: parseInt(e.target.value, 10) || 90 })}
              />
              <div className="mt-1 text-[11px] text-zinc-500">
                Next due date = last completion + N days. 90 = quarterly, 30 = monthly, 365 = yearly.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <Label>Months</Label>
                <div className="grid grid-cols-6 gap-1">
                  {MONTH_LABELS.map((label, idx) => {
                    const m = idx + 1;
                    const on = (form.fixed_months || []).includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggleMonth(m)}
                        className={cn(
                          "rounded-md border px-2 py-1.5 text-xs font-medium transition",
                          on
                            ? "border-accent bg-accent/10 text-midnight"
                            : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label htmlFor="pm-day">Day of month</Label>
                <Input
                  id="pm-day"
                  type="number"
                  min={1}
                  max={28}
                  value={form.fixed_day_of_month ?? 15}
                  onChange={(e) => setForm({ ...form, fixed_day_of_month: parseInt(e.target.value, 10) || 1 })}
                />
                <div className="mt-1 text-[11px] text-zinc-500">
                  Capped at 28 so every month resolves cleanly (no Feb 30th surprise).
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pm-lead">Lead days</Label>
              <Input
                id="pm-lead"
                type="number"
                min={0}
                value={form.lead_days ?? 7}
                onChange={(e) => setForm({ ...form, lead_days: parseInt(e.target.value, 10) || 0 })}
              />
              <div className="mt-1 text-[11px] text-zinc-500">
                Spawn the ticket this many days before due.
              </div>
            </div>
            <div>
              <Label htmlFor="pm-cost">Est. cost (optional)</Label>
              <Input
                id="pm-cost"
                type="number"
                step="0.01"
                min={0}
                value={form.est_cost ?? ""}
                onChange={(e) => setForm({ ...form, est_cost: e.target.value })}
                placeholder="0.00"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active ?? true}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            Active (uncheck to pause this template; existing tickets aren't affected)
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !form.name.trim()}
          >
            {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Schedules view ────────────────────────────────────────────────

function SchedulesView() {
  const toast = useToast();
  const qc = useQueryClient();
  const schedulesQ = useQuery({ queryKey: ["pm-schedules"], queryFn: () => listPmSchedules() });
  const templatesQ = useQuery({ queryKey: ["pm-templates"], queryFn: listPmTemplates });
  // Shared vendors list for every inline picker in the table. Single
  // round trip even when 100 stores are listed.
  const vendorsQ = useQuery({ queryKey: ["pm-vendors-list"], queryFn: () => fetchVendors() });
  const [assigning, setAssigning] = useState(false);

  const del = useMutation({
    mutationFn: (id: string) => deletePmSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pm-schedules"] });
      toast.push("Schedule removed.", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Delete failed.", "error"),
  });

  const spawn = useMutation({
    mutationFn: () => spawnDuePmsNow(false),
    onSuccess: (res) => {
      toast.push(
        `Spawned ${res.spawned.length} ticket(s); skipped ${res.skipped.length}.`,
        res.spawned.length > 0 ? "success" : "info",
      );
      qc.invalidateQueries({ queryKey: ["pm-schedules"] });
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Spawn failed.", "error"),
  });

  const schedules = schedulesQ.data?.schedules || [];

  // Group by template name for readability.
  const grouped = useMemo(() => {
    const m = new Map<string, PmSchedule[]>();
    for (const s of schedules) {
      const key = s.pm_templates?.name || "(unknown template)";
      const arr = m.get(key) || [];
      arr.push(s);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [schedules]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-zinc-600">
          Assign templates to stores. The daily spawner creates tickets when
          something hits its lead window.
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => spawn.mutate()}
            disabled={spawn.isPending}
          >
            {spawn.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Spawn due now
          </Button>
          <Button
            variant="primary"
            onClick={() => setAssigning(true)}
            disabled={(templatesQ.data?.templates || []).length === 0}
          >
            <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
            Assign template
          </Button>
        </div>
      </div>

      {schedulesQ.isLoading && <Skeleton className="h-32 w-full" />}
      {!schedulesQ.isLoading && schedules.length === 0 && (
        <EmptyState
          title="No schedules yet"
          description="Pick a template and one or more stores to start the rotation."
        />
      )}

      <div className="space-y-3">
        {grouped.map(([templateName, rows]) => (
          <Card key={templateName}>
            <CardBody className="space-y-2">
              <div className="text-sm font-semibold tracking-tight text-midnight">{templateName}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-zinc-500">
                      <th className="py-1 pr-3">Store</th>
                      <th className="py-1 pr-3">Next due</th>
                      <th className="py-1 pr-3">Last completed</th>
                      <th className="py-1 pr-3">Vendor override</th>
                      <th className="py-1 pr-3">Open ticket</th>
                      <th className="py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const daysOut = daysFromNow(s.next_due_at);
                      const tone =
                        daysOut === null ? "neutral"
                        : daysOut < 0 ? "danger"
                        : daysOut <= 14 ? "warning"
                        : "neutral";
                      return (
                        <tr key={s.id} className="border-b border-zinc-50 last:border-b-0">
                          <td className="py-1.5 pr-3 font-medium text-midnight">
                            #{s.stores?.number} <span className="text-zinc-500 font-normal">{s.stores?.name}</span>
                          </td>
                          <td className="py-1.5 pr-3">
                            <Badge tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "neutral"}>
                              {fmtDate(s.next_due_at)}
                              {daysOut !== null && (
                                <span className="ml-1 text-[10px]">
                                  ({daysOut < 0 ? `${-daysOut}d overdue` : `${daysOut}d`})
                                </span>
                              )}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-3 text-zinc-600">{fmtDate(s.last_completed_at)}</td>
                          <td className="py-1.5 pr-3 text-zinc-600">
                            <ScheduleVendorPicker
                              schedule={s}
                              vendors={vendorsQ.data?.vendors || []}
                              templateDefaultName={
                                (templatesQ.data?.templates || [])
                                  .find((t) => t.id === s.template_id)?.vendors?.name || null
                              }
                            />
                          </td>
                          <td className="py-1.5 pr-3">
                            {s.last_ticket_id ? (
                              <Badge tone="info">Spawned</Badge>
                            ) : (
                              <span className="text-zinc-400">—</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Remove ${templateName} from store ${s.stores?.number}?`)) {
                                  del.mutate(s.id);
                                }
                              }}
                              className="rounded-md p-1 text-red-600 hover:bg-red-50"
                              title="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {assigning && (
        <AssignScheduleModal
          templates={templatesQ.data?.templates || []}
          onClose={() => setAssigning(false)}
          onSaved={() => {
            setAssigning(false);
            qc.invalidateQueries({ queryKey: ["pm-schedules"] });
          }}
        />
      )}
    </div>
  );
}

interface AssignScheduleModalProps {
  templates: PmTemplate[];
  onClose: () => void;
  onSaved: () => void;
}

function AssignScheduleModal({ templates, onClose, onSaved }: AssignScheduleModalProps) {
  const toast = useToast();
  const storesQ = useQuery({
    queryKey: ["pm-assign-stores"],
    queryFn: fetchCallerStores,
  });
  const vendorsQ = useQuery({
    queryKey: ["pm-assign-vendors"],
    queryFn: () => fetchVendors(),
  });

  const [templateId, setTemplateId] = useState(templates[0]?.id || "");
  const [storeIds, setStoreIds] = useState<Set<string>>(new Set());
  const [overrideVendorId, setOverrideVendorId] = useState<string>("");
  const [explicitDue, setExplicitDue] = useState<string>("");
  const [storeFilter, setStoreFilter] = useState("");

  const stores = storesQ.data?.stores || [];
  const filteredStores = stores.filter((s) => {
    if (!storeFilter.trim()) return true;
    const q = storeFilter.trim().toLowerCase();
    return s.number.toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q);
  });

  const save = useMutation({
    mutationFn: () => upsertPmSchedule({
      template_id: templateId,
      store_ids: Array.from(storeIds),
      override_vendor_id: overrideVendorId || null,
      next_due_at: explicitDue || null,
      is_active: true,
    }),
    onSuccess: (res) => {
      toast.push(`Scheduled at ${res.schedules.length} store(s).`, "success");
      onSaved();
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  const selectedTemplate = templates.find((t) => t.id === templateId);
  const allFilteredSelected = filteredStores.length > 0 &&
    filteredStores.every((s) => storeIds.has(s.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="my-8 w-full max-w-xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">Assign template to stores</div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div>
            <Label htmlFor="assign-template">Template</Label>
            <select
              id="assign-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.performer_type})
                </option>
              ))}
            </select>
          </div>

          {selectedTemplate?.performer_type === "vendor" && (
            <div>
              <Label htmlFor="assign-vendor-override">Vendor override (optional)</Label>
              <select
                id="assign-vendor-override"
                value={overrideVendorId}
                onChange={(e) => setOverrideVendorId(e.target.value)}
                className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Use template's default ({selectedTemplate.vendors?.name || "none"})</option>
                {(vendorsQ.data?.vendors || []).map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label htmlFor="assign-due">First due date (optional)</Label>
            <input
              id="assign-due"
              type="date"
              value={explicitDue}
              onChange={(e) => setExplicitDue(e.target.value)}
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="mt-1 text-[11px] text-zinc-500">
              Leave blank to auto-compute from the template's cadence.
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>Stores ({storeIds.size} selected)</Label>
              <button
                type="button"
                onClick={() => {
                  if (allFilteredSelected) {
                    const next = new Set(storeIds);
                    for (const s of filteredStores) next.delete(s.id);
                    setStoreIds(next);
                  } else {
                    const next = new Set(storeIds);
                    for (const s of filteredStores) next.add(s.id);
                    setStoreIds(next);
                  }
                }}
                className="text-[11px] text-accent hover:underline"
              >
                {allFilteredSelected ? "Clear filtered" : "Select all filtered"}
              </button>
            </div>
            <Input
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              placeholder="Filter by store number or name…"
              className="mb-2"
            />
            <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200">
              {storesQ.isLoading && <div className="px-3 py-2 text-xs text-zinc-500">Loading stores…</div>}
              {!storesQ.isLoading && filteredStores.length === 0 && (
                <div className="px-3 py-2 text-xs text-zinc-500">No stores match.</div>
              )}
              {filteredStores.map((s) => {
                const on = storeIds.has(s.id);
                return (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const next = new Set(storeIds);
                        if (on) next.delete(s.id); else next.add(s.id);
                        setStoreIds(next);
                      }}
                      className="h-4 w-4 accent-accent"
                    />
                    <span className="font-medium text-midnight">#{s.number}</span>
                    <span className="text-zinc-500">{s.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !templateId || storeIds.size === 0}
          >
            {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Assign
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Inline vendor picker for an existing schedule row ─────────────
// Compact <select> that PATCHes pm_schedule.override_vendor_id on
// change. Lets admins assign a different vendor per store after a
// bulk-assign without nuking the schedule's next_due_at / completion
// history.

interface ScheduleVendorPickerProps {
  schedule: PmSchedule;
  vendors: { id: string; name: string; category?: string | null }[];
  templateDefaultName: string | null;
}

function ScheduleVendorPicker({
  schedule,
  vendors,
  templateDefaultName,
}: ScheduleVendorPickerProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const isInternal = schedule.pm_templates?.performer_type === "internal";
  // Optimistic local value so the select doesn't flicker between
  // mutation start and cache refetch.
  const [pending, setPending] = useState<string | null>(null);
  const current = pending !== null ? pending : (schedule.override_vendor_id || "");

  const patch = useMutation({
    mutationFn: (vendorId: string) =>
      patchPmSchedule(schedule.id, {
        override_vendor_id: vendorId || null,
      }),
    onSuccess: () => {
      toast.push("Vendor updated.", "success");
      qc.invalidateQueries({ queryKey: ["pm-schedules"] });
    },
    onError: (e) => {
      toast.push(e instanceof Error ? e.message : "Update failed.", "error");
      setPending(null);
    },
  });

  if (isInternal) {
    return <span className="text-zinc-400">n/a (internal)</span>;
  }

  return (
    <select
      value={current}
      disabled={patch.isPending}
      onChange={(e) => {
        const next = e.target.value;
        setPending(next);
        patch.mutate(next);
      }}
      className="block w-full max-w-[200px] rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
    >
      <option value="">
        Use default{templateDefaultName ? ` (${templateDefaultName})` : ""}
      </option>
      {vendors.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
}
