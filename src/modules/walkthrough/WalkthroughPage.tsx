// Walkthrough — mobile-first design-import preview of the per-section
// form-fill experience from the 2026 design canvas.
//
// PREVIEW: this page uses hardcoded sample data (a "Weekly Walkthrough"
// at SDI 4287 with 7 sections) and is not wired to a real submission.
// The interactive bits — Pass/Watch/Fail toggles, Save-status pill,
// section progress — all work locally so you can feel the flow. Real
// submission save lives in the existing SubmissionFormPage; promoting
// this design into that flow is the follow-up once the pattern is
// approved.

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  Paperclip,
} from "lucide-react";
import { AppHeader } from "@/shared/ui/AppHeader";
import { StatusPill, type StatusPillKind } from "@/shared/ui/StatusPill";
import { BottomBar } from "@/shared/ui/BottomBar";
import { cn } from "@/lib/cn";

type ItemValue = "pass" | "watch" | "fail" | null;
type SectionState = "done" | "active" | "pending";

interface ItemSpec {
  id: string;
  label: string;
  initial: ItemValue;
  photo?: boolean;
  note?: string;
}

interface SectionSpec {
  id: string;
  name: string;
  state: SectionState;
}

const SECTIONS: SectionSpec[] = [
  { id: "lot",        name: "Lot & exterior",  state: "done" },
  { id: "fryer",      name: "Fryer & line",    state: "done" },
  { id: "fountain",   name: "Fountain",        state: "done" },
  { id: "dt",         name: "Drive-thru",      state: "active" },
  { id: "patio",      name: "Patio & stalls",  state: "pending" },
  { id: "restrooms",  name: "Restrooms",       state: "pending" },
  { id: "closeout",   name: "Close-out",       state: "pending" },
];

const DRIVE_THRU_ITEMS: ItemSpec[] = [
  { id: "headset",     label: "Headset clarity & charge",          initial: "pass" },
  { id: "order",       label: "Order accuracy spot check (5 cars)", initial: "pass" },
  { id: "menu",        label: "Menu board legibility & lighting",  initial: "watch", photo: true, note: "Top-right LED flickering at dusk." },
  { id: "stalls",      label: "Stall call-button latency ≤ 4s", initial: null },
  { id: "speed",       label: "Avg service time ≤ 3:30",       initial: null },
  { id: "cleanliness", label: "Lane & curb cleanliness",            initial: null },
];

const DEFAULT_SECTION_NOTE =
  "Lane #2 paint refresh scheduled for 5/27. Carhop training cohort starts Tuesday.";

export function WalkthroughPage() {
  const [items, setItems] = useState(
    DRIVE_THRU_ITEMS.map((it) => ({ ...it, value: it.initial })),
  );
  const [sectionNote, setSectionNote] = useState(DEFAULT_SECTION_NOTE);
  const [saveState, setSaveState] = useState<StatusPillKind>("saved");
  const [savedAt, setSavedAt] = useState<string>("11:42");
  const saveTimer = useRef<number | null>(null);

  // Choreograph the saving / saved pill — pulse "Saving" for ~700ms
  // after a change, then settle on "Saved HH:MM". Mirrors what the real
  // SubmissionFormPage already does on autosave.
  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  function noteChange() {
    setSaveState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaveState("saved");
      setSavedAt(formatHM(new Date()));
    }, 700);
  }

  function setItemValue(id: string, value: ItemValue) {
    setItems((prev) =>
      prev.map((x) => (x.id === id ? { ...x, value } : x)),
    );
    noteChange();
  }

  const completed = items.filter((i) => i.value !== null).length;
  const total = items.length;
  const pct = Math.round((completed / Math.max(1, total)) * 100);
  const activeIdx = SECTIONS.findIndex((s) => s.state === "active");
  const nextSection = SECTIONS[activeIdx + 1];

  const saveLabel =
    saveState === "saving" ? "Saving" : `Saved ${savedAt}`;

  return (
    <div className="mx-auto w-full max-w-md bg-surface-muted min-h-full">
      <AppHeader
        title="Weekly Walkthrough"
        subtitle="SDI 4287 · Mansfield, TX"
        leading={
          <button
            type="button"
            className="-ml-1 p-1 text-midnight-700"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2} />
          </button>
        }
        trailing={<StatusPill kind={saveState}>{saveLabel}</StatusPill>}
      />

      {/* Section pager — sticky beneath the header. Shows current section
          name, item progress, and the 7-segment dash bar that tells the
          GM what's done / active / pending without leaving the page. */}
      <div className="sticky top-12 z-10 bg-white border-b border-midnight-100 px-4 pt-3 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[11px] font-medium tracking-wide uppercase text-midnight-500">
              Section {activeIdx + 1} of {SECTIONS.length}
            </div>
            <div className="text-[17px] font-semibold text-midnight-900 leading-tight">
              Drive-thru
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-midnight-500">{completed}/{total} items</div>
            <div className="text-[13px] font-semibold tabular-nums text-midnight-900">{pct}%</div>
          </div>
        </div>
        <div className="flex gap-1">
          {SECTIONS.map((s) => (
            <div
              key={s.id}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                s.state === "done"
                  ? "bg-midnight-900"
                  : s.state === "active"
                  ? "bg-accent-500"
                  : "bg-midnight-100",
              )}
            />
          ))}
        </div>
      </div>

      {/* Checklist */}
      <div className="px-4 pt-4 pb-40 space-y-2.5">
        {items.map((it, i) => (
          <ChecklistItem
            key={it.id}
            seq={i + 1}
            label={it.label}
            value={it.value}
            photo={it.photo}
            note={it.note}
            onChange={(v) => setItemValue(it.id, v)}
          />
        ))}

        <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-midnight-500">
            Section note
          </div>
          <textarea
            rows={2}
            value={sectionNote}
            onChange={(e) => {
              setSectionNote(e.target.value);
              noteChange();
            }}
            placeholder="Optional context for the DO…"
            className="mt-2 w-full text-[13px] text-midnight-800 placeholder:text-midnight-300 bg-transparent outline-none resize-none"
          />
        </div>

        <PreviewNote />
      </div>

      <BottomBar>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex-1 h-11 rounded-lg ring-1 ring-midnight-200 text-midnight-800 text-[14px] font-medium bg-white hover:bg-surface-muted transition"
          >
            Save draft
          </button>
          <button
            type="button"
            className="flex-[1.4] h-11 rounded-lg bg-midnight-900 text-white text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-midnight-800 transition"
          >
            Next: {nextSection?.name ?? "Submit"}
            <ChevronRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </BottomBar>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Single checklist row — sequence label, item text, Pass/Watch/Fail
// segmented, plus photo + note affordances. The Pass/Watch/Fail tones
// are tied to .bg-ok / .bg-warn / .bg-bad so they read with the right
// emotional weight in field conditions (glove use, glare).
// ----------------------------------------------------------------------------

const OPTIONS: { value: Exclude<ItemValue, null>; label: string; on: string }[] = [
  { value: "pass",  label: "Pass",  on: "bg-ok/15 ring-ok text-midnight-900" },
  { value: "watch", label: "Watch", on: "bg-warn/20 ring-warn text-midnight-900" },
  { value: "fail",  label: "Fail",  on: "bg-bad/15 ring-bad text-midnight-900" },
];

function ChecklistItem({
  seq,
  label,
  value,
  photo,
  note,
  onChange,
}: {
  seq: number;
  label: string;
  value: ItemValue;
  photo?: boolean;
  note?: string;
  onChange: (v: ItemValue) => void;
}) {
  const code = `DT.${String(seq).padStart(2, "0")}`;
  const hasEvidence = !!(photo || note);

  return (
    <div className="bg-surface rounded-xl ring-1 ring-midnight-100 shadow-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] font-mono text-midnight-400">{code}</div>
          <div className="text-[14px] font-medium text-midnight-900 leading-snug">{label}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(active ? null : opt.value)}
              className={cn(
                "h-9 rounded-lg text-[13px] font-semibold transition ring-1",
                active
                  ? opt.on
                  : "bg-white ring-midnight-200 text-midnight-500 hover:ring-midnight-300",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {hasEvidence && (
        <div className="mt-2.5 flex items-stretch gap-2">
          <div className="w-16 h-16 rounded-md placeholder-stripes ring-1 ring-midnight-100 flex items-center justify-center">
            <Camera className="h-4 w-4 text-midnight-400" strokeWidth={2} />
          </div>
          <div className="flex-1 bg-midnight-50 rounded-md px-3 py-2 text-[12.5px] text-midnight-700 leading-snug">
            {note ?? "Photo attached."}
          </div>
        </div>
      )}

      {value && !hasEvidence && (
        <div className="mt-2 flex items-center gap-3 text-[11.5px] text-midnight-500">
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-midnight-800"
          >
            <Camera className="h-3 w-3" strokeWidth={2} /> Add photo
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-midnight-800"
          >
            <Paperclip className="h-3 w-3" strokeWidth={2} /> Note
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewNote() {
  return (
    <div className="px-1 pt-2">
      <p className="text-[10.5px] leading-snug text-midnight-400">
        Preview — interactive design demo with sample data. Real walkthrough
        submissions still go through Workspaces; this page exists to feel out
        the mobile-first form pattern.
      </p>
    </div>
  );
}

function formatHM(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m}`;
}
