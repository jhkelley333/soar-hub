// Walkthrough builder — small reusable form controls. Desktop styling on the
// admin palette (midnight / zinc / accent), kept local to the builder so they
// don't compete with the shared UI kit's higher-level components.

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="block text-xs font-medium text-zinc-600">{label}</span>
      {hint && <span className="block text-[11px] text-zinc-400">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full h-9 rounded-md ring-1 ring-inset ring-zinc-200 bg-white px-3 text-sm text-midnight outline-none focus:ring-2 focus:ring-accent";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...props} className={cn(inputCls, "tabular-nums", props.className)} />;
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputCls, "capitalize", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 text-left"
      aria-pressed={checked}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-accent" : "bg-zinc-300",
        )}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
      <span>
        <span className="block text-sm font-medium text-midnight">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </button>
  );
}

/** Edit a list of short string chips (e.g. reason options). */
export function ChipsEditor({
  values,
  onChange,
  placeholder = "Add option…",
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  function add() {
    const v = text.trim();
    if (!v || values.includes(v)) {
      setText("");
      return;
    }
    onChange([...values, v]);
    setText("");
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-zinc-400 hover:text-zinc-700"
              aria-label={`Remove ${v}`}
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        <TextInput
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="h-8"
        />
        <button
          type="button"
          onClick={add}
          className="h-8 shrink-0 rounded-md px-3 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
