// Create / edit a native schedule event.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { useToast } from "@/shared/ui/Toaster";
import { createEvent, deleteEvent, updateEvent } from "./api";
import { EVENT_TYPE_ORDER, TYPE_META, type DistrictGroup, type EventInput, type EventType, type ScheduleEvent } from "./types";

// ISO date (YYYY-MM-DD) + time (HH:MM) → ISO timestamp in the user's tz. All-day
// events anchor at 09:00 local so a tz shift can't bump them to the wrong day.
function toIso(date: string, time: string): string {
  return new Date(`${date}T${time || "09:00"}:00`).toISOString();
}
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function EventModal({
  open,
  onClose,
  event,
  defaultDate,
  districts,
  canOrgWide,
}: {
  open: boolean;
  onClose: () => void;
  event: ScheduleEvent | null;
  defaultDate: string | null;
  districts: DistrictGroup[];
  canOrgWide: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const editing = !!event;

  const [title, setTitle] = useState(event?.title ?? "");
  const [type, setType] = useState<EventType>(event?.type ?? "store_visit");
  const [date, setDate] = useState(event ? localDate(event.starts_at) : defaultDate ?? localDate(new Date().toISOString()));
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [startTime, setStartTime] = useState(event && !event.all_day ? localTime(event.starts_at) : "09:00");
  const [endTime, setEndTime] = useState(event?.ends_at && !event.all_day ? localTime(event.ends_at) : "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  // Scope: "org" or a store id.
  const [scopeValue, setScopeValue] = useState<string>(
    event ? (event.scope_type === "org" ? "org" : event.scope_id ?? "") : ""
  );

  const storeIndex = useMemo(() => {
    const m = new Map<string, { number: string; name: string | null }>();
    for (const g of districts) for (const s of g.stores) m.set(s.id, { number: s.number, name: s.name });
    return m;
  }, [districts]);

  function buildInput(): EventInput | string {
    if (!title.trim()) return "Add a title.";
    if (!date) return "Pick a date.";
    if (!scopeValue) return "Pick where this event belongs.";
    const isOrg = scopeValue === "org";
    return {
      ...(event ? { id: event.id } : {}),
      title: title.trim(),
      type,
      starts_at: allDay ? toIso(date, "09:00") : toIso(date, startTime),
      ends_at: !allDay && endTime ? toIso(date, endTime) : null,
      all_day: allDay,
      scope_type: isOrg ? "org" : "store",
      scope_id: isOrg ? null : scopeValue,
      store_number: isOrg ? null : storeIndex.get(scopeValue)?.number ?? null,
      notes: notes.trim() || null,
    };
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["schedule-events"] });
  }

  const saveMut = useMutation({
    mutationFn: (input: EventInput) => (editing ? updateEvent(input) : createEvent(input)),
    onSuccess: () => {
      toast.push(editing ? "Event updated." : "Event created.", "success");
      invalidate();
      onClose();
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Save failed.", "error"),
  });
  const delMut = useMutation({
    mutationFn: () => deleteEvent(event!.id),
    onSuccess: () => {
      toast.push("Event deleted.", "success");
      invalidate();
      onClose();
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Delete failed.", "error"),
  });

  const busy = saveMut.isPending || delMut.isPending;

  function onSave() {
    const input = buildInput();
    if (typeof input === "string") {
      toast.push(input, "error");
      return;
    }
    saveMut.mutate(input);
  }

  const footer = (
    <>
      {editing && (
        <button
          type="button"
          disabled={busy}
          onClick={() => { if (window.confirm("Delete this event?")) delMut.mutate(); }}
          className="mr-auto rounded-md px-2.5 py-1.5 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      )}
      <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button disabled={busy} onClick={onSave}>{busy ? "Saving…" : editing ? "Save" : "Create event"}</Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit event" : "New event"} footer={footer}>
      <div className="space-y-4">
        <label className="block">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Title</div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mansfield store visit" autoFocus />
        </label>

        <label className="block">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Type</div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EventType)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {EVENT_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>{TYPE_META[t].label}</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Date</div>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex items-end gap-2 pb-2">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent" />
            <span className="text-sm text-zinc-700">All day</span>
          </label>
        </div>

        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Start</div>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label className="block">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">End <span className="font-normal normal-case text-zinc-400">(optional)</span></div>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          </div>
        )}

        <label className="block">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Where</div>
          <select
            value={scopeValue}
            onChange={(e) => setScopeValue(e.target.value)}
            className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="" disabled>Select a store…</option>
            {canOrgWide && <option value="org">Company-wide</option>}
            {districts.map((g) => (
              <optgroup key={g.district_id ?? "none"} label={g.district_name ? `${g.district_name}${g.district_code ? ` (${g.district_code})` : ""}` : "Stores"}>
                {g.stores.map((s) => (
                  <option key={s.id} value={s.id}>#{s.number}{s.name ? ` — ${s.name}` : ""}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Notes <span className="font-normal normal-case text-zinc-400">(optional)</span></div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="block w-full resize-y rounded-md border-0 bg-white px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
      </div>
    </Modal>
  );
}
