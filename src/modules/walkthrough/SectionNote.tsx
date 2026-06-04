// Walkthrough — per-section free-text note, pinned to the bottom of each
// section. Optional context for the DO; autosaves through the store like
// every other mutation.

export interface SectionNoteProps {
  value: string;
  onChange: (value: string) => void;
}

export function SectionNote({ value, onChange }: SectionNoteProps) {
  return (
    <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-midnight-500">
        Section note
      </div>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional context for the DO…"
        className="mt-2 w-full text-[13px] text-midnight-800 placeholder:text-midnight-300 bg-transparent outline-none resize-none"
      />
    </div>
  );
}
