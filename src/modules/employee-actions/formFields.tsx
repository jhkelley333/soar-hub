// Shared form-field primitives for the Employee Action forms. Mirrors the
// look of the PAF form (Label + ring-1 inputs, red asterisk for required,
// 11px helper text) so the new forms match the rest of the app.

import { cn } from "@/lib/cn";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import type { MyStore, PtoVacationDayInput, TrainingDayInput } from "./types";

const selectCls =
  "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";

// Default store for a submitter: prefer their primary store, else the only
// store they can see (typical single-store GM). Returns "" when ambiguous
// (DOs/RVPs who see many stores and have no primary). Compares against the
// store number, which is what the form/select binds to.
export function pickDefaultStoreNumber(
  stores: MyStore[],
  primaryStoreId: string | null | undefined
): string {
  if (primaryStoreId) {
    const match = stores.find((s) => s.id === primaryStoreId);
    if (match) return String(match.number);
  }
  if (stores.length === 1) return String(stores[0].number);
  return "";
}

function FieldLabel({
  htmlFor,
  label,
  required,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
}) {
  return (
    <Label htmlFor={htmlFor}>
      {label}
      {required && <span className="ml-0.5 text-red-600">*</span>}
    </Label>
  );
}

function Help({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="mt-0.5 text-[11px] text-zinc-500">{text}</p>;
}

export function TextField({
  id,
  label,
  value,
  onChange,
  required,
  placeholder,
  helpText,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} required={required} />
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <Help text={helpText} />
    </div>
  );
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  required,
  placeholder,
  helpText,
  step = "0.01",
  prefix,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  step?: string;
  prefix?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} required={required} />
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400">
            {prefix}
          </span>
        )}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={prefix ? "pl-7" : undefined}
        />
      </div>
      <Help text={helpText} />
    </div>
  );
}

export function DateField({
  id,
  label,
  value,
  onChange,
  required,
  helpText,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  helpText?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} required={required} />
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Help text={helpText} />
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  required,
  placeholder = "Select...",
  helpText,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
  placeholder?: string;
  helpText?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} required={required} />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <Help text={helpText} />
    </div>
  );
}

// Store dropdown bound to the caller's visible stores. Falls back to a
// free-text input when the store list is empty (server still validates).
export function StoreSelect({
  id,
  label,
  value,
  onChange,
  stores,
  required,
  helpText,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  stores: MyStore[];
  required?: boolean;
  helpText?: string;
}) {
  if (!stores.length) {
    return (
      <div>
        <FieldLabel htmlFor={id} label={label} required={required} />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Store #"
        />
        <Help text={helpText} />
      </div>
    );
  }
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} required={required} />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
      >
        <option value="">Select...</option>
        {stores.map((s) => (
          <option key={s.id} value={String(s.number)}>
            #{s.number}
            {s.name ? ` — ${s.name}` : ""}
          </option>
        ))}
      </select>
      <Help text={helpText} />
    </div>
  );
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Hours between two "HH:MM" times (0 if malformed or non-positive). The
// server recomputes this authoritatively; this is the live form preview.
export function calcDayHours(start: string, end: string): number {
  const re = /^(\d{1,2}):(\d{2})$/;
  const s = re.exec(start);
  const e = re.exec(end);
  if (!s || !e) return 0;
  const mins =
    (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  return mins > 0 ? mins / 60 : 0;
}

function fmtUSD(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// "First Three Training Days" — pick up to 3 day-of-week chips; each selected
// day gets its own start/end time, and we show the computed (hours x wage)
// amount per day plus a running total.
export function TrainingDaysEditor({
  label,
  value,
  onChange,
  wage,
  required,
  helpText,
}: {
  label: string;
  value: TrainingDayInput[];
  onChange: (v: TrainingDayInput[]) => void;
  wage: number;
  required?: boolean;
  helpText?: string;
}) {
  const selected = new Set(value.map((d) => d.day));
  const atMax = value.length >= 3;

  function toggleDay(day: string) {
    if (selected.has(day)) {
      onChange(value.filter((d) => d.day !== day));
    } else if (!atMax) {
      onChange([...value, { day, start_time: "", end_time: "" }]);
    }
  }

  function patchDay(day: string, key: "start_time" | "end_time", v: string) {
    onChange(value.map((d) => (d.day === day ? { ...d, [key]: v } : d)));
  }

  const total = value.reduce(
    (sum, d) => sum + calcDayHours(d.start_time, d.end_time) * wage,
    0
  );

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <FieldLabel htmlFor="training-days" label={label} required={required} />
      <div className="flex flex-wrap gap-2">
        {DAYS.map((day) => {
          const on = selected.has(day);
          const disabled = !on && atMax;
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              disabled={disabled}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition",
                on
                  ? "bg-accent text-accent-fg ring-accent"
                  : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
                disabled && "cursor-not-allowed opacity-40"
              )}
            >
              {day}
            </button>
          );
        })}
      </div>

      {value.length > 0 && (
        <div className="mt-3 space-y-2">
          {value.map((d) => {
            const hrs = calcDayHours(d.start_time, d.end_time);
            return (
              <div
                key={d.day}
                className="grid grid-cols-1 items-end gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 p-2 sm:grid-cols-[6rem_1fr_1fr_6rem]"
              >
                <div className="text-sm font-medium text-zinc-700">{d.day}</div>
                <div>
                  <Label htmlFor={`tt-start-${d.day}`}>Start</Label>
                  <Input
                    id={`tt-start-${d.day}`}
                    type="time"
                    value={d.start_time}
                    onChange={(e) => patchDay(d.day, "start_time", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor={`tt-end-${d.day}`}>End</Label>
                  <Input
                    id={`tt-end-${d.day}`}
                    type="time"
                    value={d.end_time}
                    onChange={(e) => patchDay(d.day, "end_time", e.target.value)}
                  />
                </div>
                <div className="text-right text-sm">
                  <div className="text-[11px] text-zinc-400">
                    {hrs ? `${hrs.toFixed(2)} hrs` : "—"}
                  </div>
                  <div className="font-semibold tabular-nums text-midnight">
                    {fmtUSD(hrs * wage)}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-sm">
            <span className="text-zinc-500">Total requested credit</span>
            <span className="font-semibold tabular-nums text-midnight">{fmtUSD(total)}</span>
          </div>
        </div>
      )}
      <Help text={helpText} />
    </div>
  );
}

export function CheckboxRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
      />
      {label}
    </label>
  );
}

const MAX_HOURS_PER_DAY = 8;

// Hourly vacation editor (Associate Manager / First Assistant): add date rows,
// enter hours per day (capped at 8), and see the per-day + total dollar amount
// (hours x wage). The server recomputes amounts authoritatively.
export function VacationHoursEditor({
  label,
  value,
  onChange,
  wage,
  required,
  helpText,
}: {
  label: string;
  value: PtoVacationDayInput[];
  onChange: (v: PtoVacationDayInput[]) => void;
  wage: number;
  required?: boolean;
  helpText?: string;
}) {
  function addRow() {
    onChange([...value, { date: "", hours: "" }]);
  }
  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function patchRow(idx: number, key: "date" | "hours", v: string) {
    onChange(value.map((r, i) => (i === idx ? { ...r, [key]: v } : r)));
  }

  const totalHours = value.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
  const totalAmount = totalHours * wage;

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <FieldLabel htmlFor="vacation-hours" label={label} required={required} />
      <div className="space-y-2">
        {value.map((r, idx) => {
          const hrs = Number(r.hours) || 0;
          const over = hrs > MAX_HOURS_PER_DAY;
          return (
            <div
              key={idx}
              className="grid grid-cols-1 items-end gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 p-2 sm:grid-cols-[1fr_8rem_6rem_2rem]"
            >
              <div>
                <Label htmlFor={`vac-date-${idx}`}>Date</Label>
                <Input
                  id={`vac-date-${idx}`}
                  type="date"
                  value={r.date}
                  onChange={(e) => patchRow(idx, "date", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`vac-hours-${idx}`}>Hours</Label>
                <Input
                  id={`vac-hours-${idx}`}
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0"
                  max={String(MAX_HOURS_PER_DAY)}
                  value={r.hours}
                  onChange={(e) => patchRow(idx, "hours", e.target.value)}
                  className={over ? "ring-red-300 focus:ring-red-400" : undefined}
                />
              </div>
              <div className="text-right text-sm">
                <div className="text-[11px] text-zinc-400">{over ? "max 8/day" : "amount"}</div>
                <div className="font-semibold tabular-nums text-midnight">{fmtUSD(hrs * wage)}</div>
              </div>
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="mb-1 justify-self-end rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="Remove day"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="mt-2 rounded-md px-3 py-1 text-xs font-medium text-accent ring-1 ring-inset ring-accent/40 hover:bg-accent/5"
      >
        + Add vacation day
      </button>

      {value.length > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-zinc-200 pt-2 text-sm">
          <span className="text-zinc-500">
            Total vacation{" "}
            <span className="tabular-nums text-zinc-700">{totalHours} hrs</span>
          </span>
          <span className="font-semibold tabular-nums text-midnight">{fmtUSD(totalAmount)}</span>
        </div>
      )}
      <Help text={helpText} />
    </div>
  );
}
