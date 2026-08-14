// NSO Planner — an interactive New Store Opening builder. Pick the Grand
// Opening date and the full 3-week Sonic playbook (hiring → training →
// opening) lays itself out around it, always aligned Monday→Sunday. Every date
// is stored as an offset from opening day, so moving the date slides the plan
// and keeps your edits. Blocks are editable, extra hiring/training weeks can be
// added, and the team mix (hired vs needed), assignees, GM and key dates (first
// food & smallwares order, PreSet, etc.) live alongside. Multiple plans show as
// cards, each named by its store. Plans persist to localStorage — no backend.
// Reached from the Operations Tools hub (/operations).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Rocket, CalendarDays, Users, Plus, Trash2, Printer, Pencil, Check,
  Store, GraduationCap, PartyPopper, Info, RotateCcw, UserRound, ArrowLeft, X, UserPlus,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { CupMark } from "@/shared/ui/CupMark";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  type NsoPlan, type PlanWeek, type PlanDay, type DayBlock,
  newPlan, addWeek, removeWeek, defaultKeyDates, defaultTeamMix, standardWeeks,
  weekName, weekSubtitle, reanchorForGrandOpening,
  dateForOffset, offsetForDate, toISO, parseISO, uid,
  fmtDow, fmtShort, fmtLong, TONE_STYLES, TONE_ORDER, TONE_LABELS,
} from "./plan";
import { bootstrap, savePlans, setActiveId as persistActiveId } from "./storage";

function daysBetweenTodayAnd(iso: string): number {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((parseISO(iso).getTime() - today.getTime()) / 86_400_000);
}
function teamTotals(plan: NsoPlan) {
  const needed = plan.teamMix.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const hired = plan.teamMix.reduce((s, r) => s + (Number(r.hired) || 0), 0);
  return { needed, hired };
}
function assigneesOf(plan: NsoPlan): string[] {
  return plan.assignees ?? [];
}

export function NsoPlannerPage() {
  const { push } = useToast();
  const [plans, setPlans] = useState<NsoPlan[]>([]);
  const [activeId, setActiveId] = useState("");
  const [view, setView] = useState<"list" | "detail">("list");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const boot = bootstrap();
    setPlans(boot.plans);
    setActiveId(boot.activeId);
  }, []);

  const plan = useMemo(() => plans.find((p) => p.id === activeId) || null, [plans, activeId]);

  function commit(next: NsoPlan[]) {
    setPlans(next);
    savePlans(next);
  }
  function update(mut: (p: NsoPlan) => NsoPlan) {
    if (!plan) return;
    commit(plans.map((p) => (p.id === activeId ? mut(p) : p)));
  }
  function openPlan(id: string) {
    setActiveId(id);
    persistActiveId(id);
    setEditing(false);
    setView("detail");
  }
  function createPlan() {
    const p = newPlan();
    commit([...plans, p]);
    setActiveId(p.id);
    persistActiveId(p.id);
    setEditing(true);
    setView("detail");
    push("New opening plan created");
  }
  function deletePlan() {
    if (!plan) return;
    if (!confirm(`Delete this opening plan${plan.storeName ? ` for ${plan.storeName}` : ""}? This can't be undone.`)) return;
    let next = plans.filter((p) => p.id !== activeId);
    if (!next.length) next = [newPlan()];
    commit(next);
    setActiveId(next[0].id);
    persistActiveId(next[0].id);
    setView("list");
    push("Plan deleted");
  }

  // nested block/day/week editors
  function mapWeek(weekId: string, fn: (w: PlanWeek) => PlanWeek) {
    update((p) => ({ ...p, weeks: p.weeks.map((w) => (w.id === weekId ? fn(w) : w)) }));
  }
  function mapDay(weekId: string, dayId: string, fn: (d: PlanDay) => PlanDay) {
    mapWeek(weekId, (w) => ({ ...w, days: w.days.map((d) => (d.id === dayId ? fn(d) : d)) }));
  }
  function mapBlock(weekId: string, dayId: string, blockId: string, fn: (b: DayBlock) => DayBlock) {
    mapDay(weekId, dayId, (d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === blockId ? fn(b) : b)) }));
  }

  function rebuildDefaults() {
    if (!plan) return;
    if (!confirm("Reset all weeks & blocks to the standard Sonic plan? Your store info, dates, assignees and team mix are kept, but block edits are lost.")) return;
    update((p) => ({ ...p, weeks: standardWeeks(p.grandOpeningISO), keyDates: defaultKeyDates(), teamMix: defaultTeamMix() }));
    push("Reset to the standard plan");
  }

  // ── LIST VIEW ────────────────────────────────────────────────────────────
  if (view === "list" || !plan) {
    return (
      <div className="pb-16">
        <PageHeader
          title={<span className="inline-flex items-center gap-2"><CupMark size={24} /> New Store Openings</span>}
          description="One card per opening. Pick the Grand Opening date and the 3-week Sonic playbook builds around it."
          actions={<Button size="sm" onClick={createPlan}><Plus className="h-4 w-4" /> New opening</Button>}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} onOpen={() => openPlan(p.id)} />
          ))}
          <button
            onClick={createPlan}
            className="flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-ink-muted transition hover:border-cherry/50 hover:text-cherry"
          >
            <Plus className="h-6 w-6" />
            <span className="text-sm font-semibold">New opening plan</span>
          </button>
        </div>
      </div>
    );
  }

  // ── DETAIL VIEW ──────────────────────────────────────────────────────────
  const days = daysBetweenTodayAnd(plan.grandOpeningISO);
  const goDate = parseISO(plan.grandOpeningISO);
  const goDow = goDate.getDay();
  const { needed: teamNeeded, hired: teamHired } = teamTotals(plan);

  return (
    <div className="pb-16">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <CupMark size={24} /> {plan.storeName || "New Store Opening"}
          </span>
        }
        description="Pick the Grand Opening date and the plan builds around it — everything's editable."
        actions={
          <div className="flex items-center gap-2" data-noprint>
            <Button variant="secondary" size="sm" onClick={() => setView("list")}>
              <ArrowLeft className="h-4 w-4" /> All plans
            </Button>
            <Button variant={editing ? "primary" : "secondary"} size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? <><Check className="h-4 w-4" /> Done</> : <><Pencil className="h-4 w-4" /> Edit</>}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        }
      />

      {/* Hero: countdown + store identity */}
      <div className="nso-week mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-cherry to-cherry-hover text-white shadow-float">
        <div className="grid gap-6 p-6 sm:grid-cols-[auto,1fr] sm:items-center">
          <div className="text-center sm:text-left">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">
              {days > 0 ? "Countdown to Grand Opening" : days === 0 ? "Today's the day" : "Now open"}
            </div>
            <div className="mt-1 flex items-baseline justify-center gap-2 sm:justify-start">
              {days > 0 ? (
                <>
                  <span className="text-6xl font-black tabular-nums leading-none">{days}</span>
                  <span className="text-xl font-bold">{days === 1 ? "day" : "days"} 🛼</span>
                </>
              ) : days === 0 ? (
                <span className="text-4xl font-black leading-none">Grand Opening! 🎉</span>
              ) : (
                <span className="text-3xl font-black leading-none">Open {Math.abs(days)} days ✅</span>
              )}
            </div>
            <div className="mt-2 text-sm font-medium text-white/90">{fmtLong(goDate)}</div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroField icon={<Store className="h-4 w-4" />} label="Store name" editing={editing}
              value={plan.storeName} placeholder="Sonic #1056 · Dallas TX #1"
              onChange={(v) => update((p) => ({ ...p, storeName: v }))} />
            <HeroField icon={<CalendarDays className="h-4 w-4" />} label="Grand Opening" editing={editing} type="date"
              value={plan.grandOpeningISO}
              onChange={(v) => v && update((p) => reanchorForGrandOpening(p, v))} />
            <HeroField icon={<UserRound className="h-4 w-4" />} label="General Manager" editing={editing}
              value={plan.gmName} placeholder="GM name"
              onChange={(v) => update((p) => ({ ...p, gmName: v }))} />
            <HeroField icon={<GraduationCap className="h-4 w-4" />} label="NSO Lead / FBC" editing={editing}
              value={plan.fbcName} placeholder="Support name"
              onChange={(v) => update((p) => ({ ...p, fbcName: v }))} />
            <div className="sm:col-span-2">
              <HeroField icon={<Rocket className="h-4 w-4" />} label="Drive-In address" editing={editing}
                value={plan.address} placeholder="Street · City, ST"
                onChange={(v) => update((p) => ({ ...p, address: v }))} />
            </div>
            <div className="sm:col-span-2">
              <AssigneesEditor
                value={assigneesOf(plan)}
                editing={editing}
                onChange={(next) => update((p) => ({ ...p, assignees: next }))}
              />
            </div>
          </div>
        </div>
      </div>

      {goDow !== 2 && (
        <div className="mb-6 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200" data-noprint>
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Sonic Grand Openings are usually a <strong>Tuesday</strong> — your date is a <strong>{fmtDow(goDate)}</strong>. The weeks still lay out
            Monday→Sunday; Friends & Family, Grand Opening and Post-Open just shift to the matching days.
          </span>
        </div>
      )}

      {/* Team mix + Key dates */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {/* Team mix */}
        <section className="nso-week rounded-2xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-heading">
              <Users className="h-4 w-4 text-cherry" /> Team Mix
            </h2>
            <span className="rounded-full bg-cherry/10 px-2.5 py-0.5 text-xs font-bold text-cherry tabular-nums">
              {teamHired}/{teamNeeded} hired
            </span>
          </div>
          {/* column labels */}
          <div className="mb-1 flex items-center gap-2 px-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">
            <span className="flex-1">Role</span>
            <span className="w-14 text-center">Hired</span>
            <span className="w-14 text-center">Needed</span>
            {editing && <span className="w-4" />}
          </div>
          <div className="space-y-1.5">
            {plan.teamMix.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                {editing ? (
                  <Input
                    value={row.role}
                    onChange={(e) => update((p) => ({ ...p, teamMix: p.teamMix.map((r) => (r.id === row.id ? { ...r, role: e.target.value } : r)) }))}
                    className="h-8 flex-1 text-sm"
                  />
                ) : (
                  <span className="flex-1 text-sm text-ink">{row.role}</span>
                )}
                <input
                  type="number" min={0} value={Number(row.hired) || 0}
                  onChange={(e) => update((p) => ({ ...p, teamMix: p.teamMix.map((r) => (r.id === row.id ? { ...r, hired: Math.max(0, Number(e.target.value) || 0) } : r)) }))}
                  className={cn(
                    "h-8 w-14 rounded-md border-0 bg-surface text-center text-sm tabular-nums ring-1 ring-inset ring-border focus:ring-2 focus:ring-accent",
                    (Number(row.hired) || 0) >= (Number(row.count) || 0) ? "text-emerald-600 font-semibold" : "text-ink"
                  )}
                />
                <input
                  type="number" min={0} value={Number(row.count) || 0}
                  onChange={(e) => update((p) => ({ ...p, teamMix: p.teamMix.map((r) => (r.id === row.id ? { ...r, count: Math.max(0, Number(e.target.value) || 0) } : r)) }))}
                  className="h-8 w-14 rounded-md border-0 bg-surface text-center text-sm tabular-nums text-ink ring-1 ring-inset ring-border focus:ring-2 focus:ring-accent"
                />
                {editing && (
                  <button
                    onClick={() => update((p) => ({ ...p, teamMix: p.teamMix.filter((r) => r.id !== row.id) }))}
                    className="w-4 text-ink-subtle hover:text-cherry" aria-label="Remove role"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {editing && (
            <button
              onClick={() => update((p) => ({ ...p, teamMix: [...p.teamMix, { id: uid(), role: "New role", count: 0, hired: 0 }] }))}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add role
            </button>
          )}
        </section>

        {/* Key dates */}
        <section className="nso-week rounded-2xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-heading">
              <CalendarDays className="h-4 w-4 text-accent" /> Key Dates
            </h2>
            {editing && (
              <button
                onClick={() => update((p) => ({ ...p, keyDates: [...p.keyDates, { id: uid(), label: "New milestone", offset: -7 }] }))}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> Add date
              </button>
            )}
          </div>
          <div className="space-y-1">
            {[...plan.keyDates].sort((a, b) => a.offset - b.offset).map((kd) => {
              const d = dateForOffset(plan.grandOpeningISO, kd.offset);
              return (
                <div key={kd.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 odd:bg-surface-muted/40">
                  {editing && !kd.anchor ? (
                    <Input
                      value={kd.label}
                      onChange={(e) => update((p) => ({ ...p, keyDates: p.keyDates.map((k) => (k.id === kd.id ? { ...k, label: e.target.value } : k)) }))}
                      className="h-8 flex-1 text-sm"
                    />
                  ) : (
                    <span className={cn("flex-1 text-sm", kd.anchor ? "font-bold text-cherry" : "text-ink")}>
                      {kd.label}{kd.anchor && " 🎉"}
                    </span>
                  )}
                  <span className="text-xs font-medium tabular-nums text-ink-muted">{fmtDow(d)}</span>
                  {editing && !kd.anchor ? (
                    <input
                      type="date" value={toISO(d)}
                      onChange={(e) => e.target.value && update((p) => ({ ...p, keyDates: p.keyDates.map((k) => (k.id === kd.id ? { ...k, offset: offsetForDate(p.grandOpeningISO, e.target.value) } : k)) }))}
                      className="h-8 rounded-md border-0 bg-surface px-2 text-sm text-ink ring-1 ring-inset ring-border focus:ring-2 focus:ring-accent"
                    />
                  ) : (
                    <span className="w-16 text-right text-sm font-semibold tabular-nums text-heading">{fmtShort(d)}</span>
                  )}
                  {editing && !kd.anchor && (
                    <button
                      onClick={() => update((p) => ({ ...p, keyDates: p.keyDates.filter((k) => k.id !== kd.id) }))}
                      className="text-ink-subtle hover:text-cherry" aria-label="Remove date"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Add-week / reset controls */}
      {editing && (
        <div className="mb-4 flex flex-wrap items-center gap-2" data-noprint>
          <span className="text-xs font-medium text-ink-muted">Extend the runway:</span>
          <Button variant="secondary" size="sm" onClick={() => { update((p) => addWeek(p, "hiring")); push("Added a hiring week"); }}>
            <Plus className="h-4 w-4" /> Hiring week
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { update((p) => addWeek(p, "training")); push("Added a training week"); }}>
            <Plus className="h-4 w-4" /> Training week
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={rebuildDefaults}>
              <RotateCcw className="h-4 w-4" /> Reset to standard
            </Button>
            <Button variant="ghost" size="sm" className="text-cherry hover:bg-cherry/10" onClick={deletePlan}>
              <Trash2 className="h-4 w-4" /> Delete plan
            </Button>
          </div>
        </div>
      )}

      {/* Weeks */}
      <div className="space-y-6">
        {plan.weeks.map((week, i) => (
          <WeekBoard
            key={week.id}
            week={week}
            ordinal={i + 1}
            plan={plan}
            editing={editing}
            onRemoveWeek={week.kind !== "opening" ? () => update((p) => removeWeek(p, week.id)) : undefined}
            onRenameWeek={(name) => mapWeek(week.id, (w) => ({ ...w, name: name || undefined }))}
            mapDay={mapDay}
            mapBlock={mapBlock}
          />
        ))}
      </div>

      {/* Notes */}
      <section className="nso-week mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-2 text-sm font-semibold tracking-tight text-heading">Notes</h2>
        {editing ? (
          <textarea
            value={plan.notes}
            onChange={(e) => update((p) => ({ ...p, notes: e.target.value }))}
            rows={4}
            placeholder="Swag for Grand Opening · trainers needed for weeks 2–3 · anything else the team should know…"
            className="block w-full rounded-md border-0 bg-surface px-3 py-2 text-sm text-ink ring-1 ring-inset ring-border placeholder:text-ink-subtle focus:ring-2 focus:ring-accent"
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-ink-muted">{plan.notes || "—"}</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan card (list view) — one per opening, named by store
// ---------------------------------------------------------------------------
function PlanCard({ plan, onOpen }: { plan: NsoPlan; onOpen: () => void }) {
  const days = daysBetweenTodayAnd(plan.grandOpeningISO);
  const { needed, hired } = teamTotals(plan);
  const people = assigneesOf(plan);
  const countChip =
    days > 0 ? `${days} ${days === 1 ? "day" : "days"} out` : days === 0 ? "Opening today 🎉" : `Open ${Math.abs(days)}d`;
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col rounded-2xl border border-border bg-surface p-5 text-left shadow-card transition hover:border-cherry/50 hover:shadow-float"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-bold tracking-tight text-heading">
            {plan.storeName || "Untitled opening"}
          </div>
          <div className="mt-0.5 text-xs text-ink-muted">{fmtLong(parseISO(plan.grandOpeningISO))}</div>
        </div>
        <span className={cn(
          "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums",
          days < 0 ? "bg-emerald-100 text-emerald-700" : days <= 14 ? "bg-cherry/10 text-cherry" : "bg-accent/10 text-accent"
        )}>
          {countChip}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="font-semibold uppercase tracking-wide text-ink-subtle text-[10px]">GM</div>
          <div className="truncate text-ink">{plan.gmName || "—"}</div>
        </div>
        <div>
          <div className="font-semibold uppercase tracking-wide text-ink-subtle text-[10px]">Team hired</div>
          <div className="tabular-nums text-ink">{hired}/{needed}</div>
        </div>
      </div>
      {people.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {people.slice(0, 4).map((p, i) => (
            <span key={i} className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted">{p}</span>
          ))}
          {people.length > 4 && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-subtle">+{people.length - 4}</span>}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Assignees editor — chips + add input, styled for the dark hero
// ---------------------------------------------------------------------------
function AssigneesEditor({ value, editing, onChange }: { value: string[]; editing: boolean; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function add() {
    const name = draft.trim();
    if (!name || value.includes(name)) { setDraft(""); return; }
    onChange([...value, name]);
    setDraft("");
  }
  return (
    <div className="rounded-lg bg-white/10 px-3 py-2 ring-1 ring-white/15">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60">
        <UserPlus className="h-4 w-4" /> Assigned to
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {value.length === 0 && !editing && <span className="text-sm text-white/40">—</span>}
        {value.map((name) => (
          <span key={name} className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[12.5px] font-semibold text-white">
            {name}
            {editing && (
              <button onClick={() => onChange(value.filter((n) => n !== name))} className="text-white/70 hover:text-white" aria-label={`Remove ${name}`}>
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {editing && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            onBlur={add}
            placeholder="Add name…"
            className="min-w-[7rem] flex-1 bg-transparent text-sm font-semibold text-white placeholder:text-white/40 outline-none"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero field — inline label + value, becomes an input in edit mode
// ---------------------------------------------------------------------------
function HeroField({
  icon, label, value, onChange, editing, placeholder, type = "text",
}: {
  icon: ReactNode; label: string; value: string;
  onChange: (v: string) => void; editing: boolean; placeholder?: string; type?: string;
}) {
  return (
    <label className="block rounded-lg bg-white/10 px-3 py-2 ring-1 ring-white/15">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60">
        {icon} {label}
      </span>
      {editing ? (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 w-full bg-transparent text-sm font-semibold text-white placeholder:text-white/40 outline-none [color-scheme:dark]"
        />
      ) : (
        <span className="mt-0.5 block text-sm font-semibold text-white">
          {value || <span className="text-white/40">{placeholder || "—"}</span>}
        </span>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Week board — a titled row of day columns
// ---------------------------------------------------------------------------
function WeekBoard({
  week, ordinal, plan, editing, onRemoveWeek, onRenameWeek, mapDay, mapBlock,
}: {
  week: PlanWeek;
  ordinal: number;
  plan: NsoPlan;
  editing: boolean;
  onRemoveWeek?: () => void;
  onRenameWeek: (name: string) => void;
  mapDay: (weekId: string, dayId: string, fn: (d: PlanDay) => PlanDay) => void;
  mapBlock: (weekId: string, dayId: string, blockId: string, fn: (b: DayBlock) => DayBlock) => void;
}) {
  const kindChip =
    week.kind === "hiring" ? "bg-accent/10 text-accent"
      : week.kind === "training" ? "bg-cherry/10 text-cherry"
        : "bg-emerald-100 text-emerald-700";
  const displayName = week.name ?? weekName(week.kind);

  return (
    <section className="nso-week rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-heading">
            <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", kindChip)}>
              {week.kind === "opening" ? <PartyPopper className="inline h-3 w-3" /> : week.kind === "training" ? <GraduationCap className="inline h-3 w-3" /> : <Users className="inline h-3 w-3" />}
            </span>
            <span className="shrink-0">Week {ordinal} ·</span>
            {editing ? (
              <input
                value={displayName}
                onChange={(e) => onRenameWeek(e.target.value)}
                className="min-w-0 flex-1 rounded border-0 bg-surface-muted px-1.5 py-0.5 text-base font-bold text-heading outline-none ring-1 ring-inset ring-border focus:ring-accent"
              />
            ) : (
              <span>{displayName}</span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">{weekSubtitle(week.kind)}</p>
        </div>
        {editing && onRemoveWeek && (
          <button onClick={onRemoveWeek} className="shrink-0 text-ink-subtle hover:text-cherry" aria-label="Remove week" data-noprint>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {week.days.map((day) => (
          <DayColumn
            key={day.id}
            day={day}
            date={dateForOffset(plan.grandOpeningISO, day.offset)}
            editing={editing}
            mapDay={(fn) => mapDay(week.id, day.id, fn)}
            mapBlock={(blockId, fn) => mapBlock(week.id, day.id, blockId, fn)}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Day column — tone header + editable blocks
// ---------------------------------------------------------------------------
function DayColumn({
  day, date, editing, mapDay, mapBlock,
}: {
  day: PlanDay;
  date: Date;
  editing: boolean;
  mapDay: (fn: (d: PlanDay) => PlanDay) => void;
  mapBlock: (blockId: string, fn: (b: DayBlock) => DayBlock) => void;
}) {
  const tone = TONE_STYLES[day.tone];
  return (
    <div className={cn("flex flex-col rounded-xl bg-surface ring-1", tone.ring)}>
      <div className={cn("rounded-t-xl px-2.5 py-2", tone.chip)}>
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wide">{fmtDow(date)}</span>
          <span className="text-[11px] font-semibold tabular-nums opacity-80">{fmtShort(date)}</span>
        </div>
        {editing ? (
          <>
            <input
              value={day.label}
              onChange={(e) => mapDay((d) => ({ ...d, label: e.target.value }))}
              placeholder="Day label"
              className="mt-0.5 w-full rounded border-0 bg-white/60 px-1 py-0.5 text-[12.5px] font-bold leading-tight text-heading outline-none ring-1 ring-inset ring-black/10 focus:ring-accent"
            />
            <div className="mt-1 flex items-center gap-1" data-noprint>
              {TONE_ORDER.map((t) => (
                <button
                  key={t}
                  onClick={() => mapDay((d) => ({ ...d, tone: t }))}
                  title={TONE_LABELS[t]}
                  aria-label={`${TONE_LABELS[t]} header`}
                  className={cn(
                    "h-4 w-4 rounded-full ring-1 ring-black/15 transition",
                    TONE_STYLES[t].dot,
                    day.tone === t && "ring-2 ring-offset-1 ring-black/50",
                  )}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="mt-0.5 text-[12.5px] font-bold leading-tight">{day.label}</div>
        )}
      </div>

      <div className="flex-1 space-y-2 p-2.5">
        {day.blocks.map((block) => (
          <div key={block.id}>
            <div className="flex items-center gap-1">
              {editing ? (
                <input
                  value={block.heading}
                  onChange={(e) => mapBlock(block.id, (b) => ({ ...b, heading: e.target.value }))}
                  className="w-full rounded border-0 bg-surface-muted px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-heading outline-none ring-1 ring-inset ring-border focus:ring-accent"
                />
              ) : (
                <div className="text-[11px] font-bold uppercase tracking-wide text-heading">{block.heading}</div>
              )}
              {editing && day.blocks.length > 1 && (
                <button
                  onClick={() => mapDay((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== block.id) }))}
                  className="shrink-0 text-ink-subtle hover:text-cherry" aria-label="Remove block"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <ul className="mt-1 space-y-1">
              {block.items.map((item, i) => (
                <li key={i} className="flex items-start gap-1">
                  {!editing && <span className={cn("mt-1.5 h-1 w-1 shrink-0 rounded-full", tone.dot)} />}
                  {editing ? (
                    <div className="flex w-full items-center gap-1">
                      <input
                        value={item}
                        onChange={(e) => mapBlock(block.id, (b) => ({ ...b, items: b.items.map((it, idx) => (idx === i ? e.target.value : it)) }))}
                        className="w-full rounded border-0 bg-surface px-1.5 py-0.5 text-[12px] text-ink outline-none ring-1 ring-inset ring-border focus:ring-accent"
                      />
                      <button
                        onClick={() => mapBlock(block.id, (b) => ({ ...b, items: b.items.filter((_, idx) => idx !== i) }))}
                        className="shrink-0 text-ink-subtle hover:text-cherry" aria-label="Remove line"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[12px] leading-snug text-ink-muted">{item}</span>
                  )}
                </li>
              ))}
            </ul>
            {editing && (
              <button
                onClick={() => mapBlock(block.id, (b) => ({ ...b, items: [...b.items, ""] }))}
                className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
              >
                <Plus className="h-3 w-3" /> Line
              </button>
            )}
          </div>
        ))}
        {editing && (
          <button
            onClick={() => mapDay((d) => ({ ...d, blocks: [...d.blocks, { id: uid(), heading: "New block", items: [""] }] }))}
            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-accent hover:underline"
          >
            <Plus className="h-3 w-3" /> Block
          </button>
        )}
      </div>
    </div>
  );
}
