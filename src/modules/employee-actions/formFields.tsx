// Shared form-field primitives for the Employee Action forms. Mirrors the
// look of the PAF form (Label + ring-1 inputs, red asterisk for required,
// 11px helper text) so the new forms match the rest of the app.

import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import type { MyStore } from "./types";

const selectCls =
  "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent";

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

// Multi-select day-of-week checkboxes (the "First Three Training Days" field).
export function DayPicker({
  label,
  value,
  onChange,
  required,
  helpText,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  required?: boolean;
  helpText?: string;
}) {
  function toggle(day: string) {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day]);
  }
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <FieldLabel htmlFor="day-picker" label={label} required={required} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DAYS.map((day) => (
          <label
            key={day}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-zinc-700"
          >
            <input
              type="checkbox"
              checked={value.includes(day)}
              onChange={() => toggle(day)}
              className="h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
            />
            {day}
          </label>
        ))}
      </div>
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
