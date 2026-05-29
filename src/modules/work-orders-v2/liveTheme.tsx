// Visual design tokens + primitives for the redesigned Work Orders UI
// (flagged: wo2_new_ui). Ported from the "Work Order - Live" design bundle.
// Keeps the app's existing font (Inter via --font-sans); mono codes use
// --font-mono. Light theme only — matches the rest of the app.

import type { CSSProperties, ReactNode } from "react";

export const WO = {
  surface: "#ffffff",
  surfaceAlt: "#fafaf7",
  ink: "#0e1116",
  ink2: "#3c424b",
  muted: "#6b7280",
  line: "#e6e6e1",
  line2: "#eeede8",
  primary: "#0b3b66",
  primaryHover: "#0a3258",
  primarySoft: "#e8f0f8",
  primaryInk: "#ffffff",
  warn: "#9a5b00",
  warnSoft: "#fff4e0",
  warnBorder: "#ecd4a3",
  ok: "#0e6a4c",
  okSoft: "#e4f3eb",
  danger: "#b54237",
  dangerSoft: "#fceae7",
  chipBg: "#f1f1ee",
  avatarBg: "#cfe1ee",
  avatarFg: "#0b3b66",
  shadow: "0 1px 2px rgba(11,59,102,.2)",
  cardShadow: "0 1px 2px rgba(11,59,102,.05), 0 1px 3px rgba(11,59,102,.04)",
  bg: "#f6f6f4",
  mono: "var(--font-mono)",
} as const;

export type PillTone = "gray" | "blue" | "warn" | "ok" | "danger";

const PILL_TONES: Record<PillTone, { bg: string; fg: string; dot: string }> = {
  gray:   { bg: WO.chipBg,      fg: WO.ink2,    dot: WO.muted },
  blue:   { bg: WO.primarySoft, fg: WO.primary, dot: WO.primary },
  warn:   { bg: WO.warnSoft,    fg: WO.warn,    dot: WO.warn },
  ok:     { bg: WO.okSoft,      fg: WO.ok,      dot: WO.ok },
  danger: { bg: WO.dangerSoft,  fg: WO.danger,  dot: WO.danger },
};

export function Pill({
  tone = "gray",
  dot = false,
  children,
  style,
}: {
  tone?: PillTone;
  dot?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const c = PILL_TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: c.bg,
        color: c.fg,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: ".04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: 6, background: c.dot }} />}
      {children}
    </span>
  );
}

export function Field({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: WO.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          color: WO.ink,
          fontWeight: 500,
          fontFamily: mono ? WO.mono : undefined,
          lineHeight: 1.4,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Card with the design's section-header-plus-divider treatment.
export function SectionCard({
  title,
  count,
  action,
  children,
  style,
}: {
  title?: string;
  count?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: WO.surface,
        border: `1px solid ${WO.line}`,
        borderRadius: 10,
        padding: "14px 16px",
        boxShadow: WO.cardShadow,
        ...style,
      }}
    >
      {title && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0, color: WO.ink }}>{title}</h2>
          {count != null && (
            <span style={{ fontSize: 11, color: WO.muted, fontFamily: WO.mono }}>{count}</span>
          )}
          <div style={{ flex: 1, height: 1, background: WO.line2 }} />
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

type Stage = { key: string; label: string; tone?: "primary" | "warn" };

// Base linear flow, in the v2 workflow order (Submitted → Scheduled →
// On Site → In Progress → Completed → Closed). Pending Approval and
// Parts on Order are CONDITIONAL — they only appear in the strip when
// the ticket is actually in that state (see buildStages).
const BASE_STAGES: Stage[] = [
  { key: "submitted", label: "Submitted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "on_site", label: "On Site" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "closed", label: "Closed" },
];

function buildStages(approvalPending: boolean, partsOnOrder: boolean): Stage[] {
  const out: Stage[] = [];
  for (const s of BASE_STAGES) {
    if (s.key === "in_progress" && approvalPending) {
      out.push({ key: "approval", label: "Pending Approval", tone: "warn" });
    }
    out.push(s);
    if (s.key === "in_progress" && partsOnOrder) {
      out.push({ key: "parts", label: "Parts on Order", tone: "warn" });
    }
  }
  return out;
}

// Resolve which stage key is "current" for a ticket.
function currentStageKey(
  status: string,
  approvalPending: boolean,
  partsOnOrder: boolean,
): string {
  if (partsOnOrder) return "parts";
  if (approvalPending) return "approval";
  switch (status) {
    case "submitted": return "submitted";
    case "scheduled": return "scheduled";
    case "on_site": return "on_site";
    case "in_progress":
    case "awaiting_equipment": return "in_progress";
    case "completed": return "completed";
    case "closed":
    case "cancelled": return "closed";
    default: return "submitted";
  }
}

// Display-only pipeline. The real transitions run through TicketActionBar;
// this just visualizes the current status, surfacing Pending Approval /
// Parts on Order only when the ticket is in those conditional states.
export function StatusPipeline({
  status,
  approvalPending = false,
  partsOnOrder = false,
}: {
  status: string;
  approvalPending?: boolean;
  partsOnOrder?: boolean;
}) {
  const stages = buildStages(approvalPending, partsOnOrder);
  const cur = Math.max(0, stages.findIndex((s) => s.key === currentStageKey(status, approvalPending, partsOnOrder)));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
        background: WO.surface,
        border: `1px solid ${WO.line}`,
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: WO.cardShadow,
      }}
    >
      {stages.map((s, i) => {
        const done = i < cur;
        const active = i === cur;
        const isCond = s.tone === "warn";
        const accent = isCond ? WO.warn : WO.primary;
        const activeBg = isCond ? WO.warnSoft : WO.primarySoft;
        return (
          <div
            key={s.key}
            style={{
              position: "relative",
              padding: "14px 16px",
              borderRight: i < stages.length - 1 ? `1px solid ${WO.line2}` : "none",
              background: active ? activeBg : done ? WO.surfaceAlt : WO.surface,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 18,
                  flex: "0 0 18px",
                  background: done ? accent : WO.surface,
                  border: `1.5px solid ${done || active ? accent : WO.line}`,
                  color: done ? WO.primaryInk : accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {done ? "✓" : active ? (
                  <span style={{ width: 6, height: 6, borderRadius: 6, background: accent }} />
                ) : ""}
              </span>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: done || active ? WO.ink : WO.ink2,
                }}
              >
                {s.label}
              </div>
            </div>
            <div
              style={{
                fontFamily: WO.mono,
                fontSize: 10,
                color: WO.muted,
                marginTop: 6,
                paddingLeft: 26,
              }}
            >
              {done ? "✓ complete" : active ? (isCond ? "current" : "in progress") : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function statusPillTone(status: string): PillTone {
  if (status === "completed" || status === "closed") return "ok";
  if (status === "cancelled") return "gray";
  if (status === "on_site" || status === "awaiting_equipment") return "warn";
  return "blue";
}

export function priorityPillTone(priority: string): PillTone {
  if (priority === "Emergency") return "danger";
  if (priority === "Urgent") return "warn";
  return "gray";
}
