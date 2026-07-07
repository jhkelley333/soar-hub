// Assessments the signed-in user is part of — as the person being assessed
// (self) or as the leader. Entry point to the rating instrument.
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, User, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { fetchNlaList } from "./api";
import { NLA_STATUS_META, type NlaListRow } from "./types";

export function NlaListPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["nla-list"], queryFn: fetchNlaList, staleTime: 30_000 });

  if (q.isLoading) return <div className="mx-auto max-w-3xl space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-40 w-full" /></div>;
  if (q.isError) return <EmptyState title="Could not load assessments" description={(q.error as Error)?.message ?? "Try again."} />;

  const rows = q.data?.assessments ?? [];
  const needsMe = rows.filter((a) => a.my_role && !a.my_submitted && a.status === "awaiting_responses");
  const rest = rows.filter((a) => !needsMe.includes(a));
  const COMPARE_READY = new Set(["both_submitted", "aligned", "acknowledged"]);
  const openRow = (a: NlaListRow) =>
    navigate(a.both_submitted || COMPARE_READY.has(a.status) ? `/nla/${a.id}/compare` : `/nla/${a.id}`);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-accent" />
        <h1 className="text-xl font-bold text-heading">Next Level Assessments</h1>
      </div>
      <p className="mb-5 text-sm text-ink-muted">Assess readiness for the next role. You and your leader each rate the same competencies, then compare and build a development plan.</p>

      {rows.length === 0 ? (
        <EmptyState title="No assessments yet" description="When a leader opens a Next Level Assessment on you — or you open one on a team member — it shows up here." />
      ) : (
        <div className="space-y-6">
          {needsMe.length > 0 && (
            <Section title="Needs your rating" rows={needsMe} onOpen={openRow} highlight />
          )}
          {rest.length > 0 && (
            <Section title="All assessments" rows={rest} onOpen={openRow} />
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, rows, onOpen, highlight }: { title: string; rows: NlaListRow[]; onOpen: (a: NlaListRow) => void; highlight?: boolean }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">{title}</div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <ul className="divide-y divide-border">
          {rows.map((a) => {
            const sm = NLA_STATUS_META[a.status] ?? { label: a.status, chip: "bg-zinc-100 text-zinc-600 ring-zinc-200" };
            const compareReady = a.both_submitted || a.status === "both_submitted" || a.status === "aligned" || a.status === "acknowledged";
            const cta = a.my_role && !a.my_submitted && a.status === "awaiting_responses" ? "Rate" : compareReady ? "Compare" : "View";
            return (
              <li key={a.id}>
                <button onClick={() => onOpen(a)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-muted", highlight && "bg-amber-50/40")}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
                    {a.my_role === "self" ? <User className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-heading">
                      {a.subject_name} <span className="text-ink-subtle">· {a.target_role.toUpperCase()}</span>
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {a.my_role === "self" ? "Your self-assessment" : `You are the leader · ${a.subject_name}`}
                      {a.my_submitted ? " · you submitted" : ""}
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", sm.chip)}>{sm.label}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent">{cta} <ArrowRight className="h-3.5 w-3.5" /></span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
