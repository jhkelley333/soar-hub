import { useState } from "react";
import { Drawer } from "@/shared/ui/Drawer";
import { PatternDetail } from "./PatternDetail";
import { patternForTrait } from "./patterns";

// A trait value (a stored `cultural_index_trait` string) rendered as a chip.
// When the value maps to a known Culture Index pattern, the chip is a button
// that opens a drawer with the full definition — so a trait shown anywhere in
// the app (GM Roster, My Account, a coaching sheet) is one tap from "what does
// that actually mean and how do I work with them?".
export function TraitChip({
  trait,
  size = "sm",
}: {
  trait: string | null | undefined;
  size?: "sm" | "xs";
}) {
  const [open, setOpen] = useState(false);
  if (!trait) return null;
  const pattern = patternForTrait(trait);

  const pad = size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs";
  const base =
    "inline-flex items-center rounded-full font-medium ring-1 ring-inset bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30";

  // Unknown trait → static chip (no definition to open).
  if (!pattern) {
    return <span className={`${base} ${pad}`}>{trait}</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${pattern.name} — view Culture Index profile`}
        className={`${base} ${pad} cursor-pointer transition hover:ring-violet-400 focus:outline-none focus:ring-2 focus:ring-accent`}
      >
        {pattern.name}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Culture Index profile">
        <PatternDetail pattern={pattern} />
      </Drawer>
    </>
  );
}
