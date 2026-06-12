// What / What / Why feedback builder. Three labeled textareas feed a live dark
// preview card that frames the manager's feedback as three sentences.
import { useState } from "react";
import { cn } from "@/lib/cn";

const FIELDS: { key: "observed" | "expected" | "why"; label: string; hint: string; placeholder: string }[] = [
  { key: "observed", label: "What", hint: "you observed", placeholder: "e.g. The patio had three uncleared trays during the rush." },
  { key: "expected", label: "What", hint: "is expected / possible", placeholder: "e.g. Trays cleared within 2 minutes so guests always see a clean patio." },
  { key: "why", label: "Why", hint: "it matters", placeholder: "e.g. A clean patio drives repeat visits and protects our standards." },
];

export function WhatWhatWhy({ chip, soft }: { chip: string; soft: string }) {
  const [v, setV] = useState({ observed: "", expected: "", why: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-3">
      {FIELDS.map((f) => (
        <div key={f.key + f.hint}>
          <label className="mb-1.5 block font-mono text-[10.5px] font-bold uppercase tracking-wider" style={{ color: chip }}>
            {f.label} <span className="font-sans text-[12px] font-normal normal-case tracking-normal text-ink-subtle">— {f.hint}</span>
          </label>
          <textarea
            value={v[f.key]} onChange={set(f.key)} rows={2} placeholder={f.placeholder}
            className="block w-full resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-3 text-sm text-ink focus:outline-none"
            style={{ boxShadow: "none" }}
            onFocus={(e) => { e.currentTarget.style.borderColor = chip; e.currentTarget.style.boxShadow = `0 0 0 3px ${soft}`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--color-border-strong)"; e.currentTarget.style.boxShadow = "none"; }}
          />
        </div>
      ))}

      <div className="rounded-2xl bg-midnight-900 p-5 text-frost-soft">
        <div className="font-mono text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "#9FD9B8" }}>Your feedback, framed</div>
        <div className="mt-2.5 space-y-2 text-[15px] leading-relaxed">
          <Line lead="Here's what I saw:" text={v.observed} ph="Here's what I saw…" />
          <Line lead="Here's what good looks like:" text={v.expected} ph="Here's what good looks like…" />
          <Line lead="And here's why it matters:" text={v.why} ph="And here's why it matters…" />
        </div>
      </div>
    </div>
  );
}
function Line({ lead, text, ph }: { lead: string; text: string; ph: string }) {
  if (!text.trim()) return <p className={cn("italic text-ink-subtle")}>{ph}</p>;
  return <p>{lead} <span className="font-medium" style={{ color: "#9FD9B8" }}>{text}</span></p>;
}
