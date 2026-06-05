// Walkthrough review — full submission detail + decision (approve / return).
//
// Read-only render of the GM's filled walk (every section/item, reasons,
// notes, photos) with the computed score/tier header, plus the DO's decision
// controls. Returning sets needs_revision; the re-walk is a new linked
// submission (immutability is enforced at the DB).

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, Loader2, MapPin, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { decideReview, getSubmissionDetail, type SubmissionDetail } from "./api";
import { IntegrityChips, ScoreBadge, StatusChip, TierChip } from "./tierUi";

function fmtDur(s: number | null): string {
  if (s == null) return "—";
  const m = Math.round(s / 60);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
import type { ItemResponse, ItemValue } from "../types";

const VALUE_UI: Record<string, { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "bg-green-100 text-green-800" },
  watch: { label: "Watch", cls: "bg-amber-100 text-amber-800" },
  fail: { label: "Fail", cls: "bg-red-100 text-red-700" },
  na: { label: "N/A", cls: "bg-zinc-100 text-zinc-500" },
};

export function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [returning, setReturning] = useState(false);
  const [notes, setNotes] = useState("");

  const query = useQuery({
    queryKey: ["wt-submission", id],
    queryFn: () => getSubmissionDetail(id!),
    enabled: !!id,
  });

  const decide = useMutation({
    mutationFn: (decision: "approve" | "needs_revision") => decideReview(id!, decision, notes),
    onSuccess: (_d, decision) => {
      qc.invalidateQueries({ queryKey: ["wt-review-queue"] });
      qc.invalidateQueries({ queryKey: ["wt-submission", id] });
      toast.push(decision === "approve" ? "Approved" : "Returned for revision", "success");
      navigate("/walkthrough-review");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Failed", "error"),
  });

  if (query.isLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink onClick={() => navigate("/walkthrough-review")} />
        <Card>
          <CardBody className="text-sm text-red-600">
            {query.error instanceof Error ? query.error.message : "Not found."}
          </CardBody>
        </Card>
      </div>
    );
  }

  const d = query.data;
  const decided = d.status === "approved" || d.status === "needs_revision";

  return (
    <div className="mx-auto max-w-3xl pb-24">
      <BackLink onClick={() => navigate("/walkthrough-review")} />
      <PageHeader
        title={`${d.storeNumber} · ${d.storeName}`}
        description={`${d.template.name} · ${d.submitterName}${d.submittedAt ? ` · ${new Date(d.submittedAt).toLocaleString()}` : ""}`}
        actions={<StatusChip status={d.status} />}
      />

      {/* Score header */}
      <Card className="mb-4">
        <CardBody className="flex items-center gap-5">
          <div className="text-center">
            <ScoreBadge score={d.score} tier={d.tier} />
            <div className="text-[11px] text-zinc-500">score</div>
          </div>
          <TierChip tier={d.tier} />
          <div className="text-sm text-zinc-600">{d.flagCount} flag{d.flagCount === 1 ? "" : "s"}</div>
          {d.checkIn && (
            <div className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
              <MapPin className="h-3.5 w-3.5" />
              {d.checkIn.geofenceResult === "on_site"
                ? "On site"
                : d.checkIn.exceptionReason
                  ? "Off-site exception"
                  : "Nearby"}
            </div>
          )}
        </CardBody>
      </Card>

      {d.checkIn?.exceptionReason && (
        <Card className="mb-4">
          <CardBody className="text-sm">
            <span className="font-medium text-amber-700">Off-site exception: </span>
            <span className="text-zinc-600">{d.checkIn.exceptionReason}</span>
          </CardBody>
        </Card>
      )}

      {/* Integrity — server-derived trust signals */}
      {d.integrity && (
        <Card className="mb-4">
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Integrity</span>
              <IntegrityChips integrity={d.integrity} />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600">
              <span>Duration: {fmtDur(d.integrity.durationSeconds)}</span>
              {d.integrity.secondsPerItem != null && <span>{d.integrity.secondsPerItem}s / item</span>}
              <span>{d.integrity.itemsAnswered} answered</span>
              <span>
                {d.integrity.photoCount} photo{d.integrity.photoCount === 1 ? "" : "s"}
                {d.integrity.photoGeoMismatch + d.integrity.photoTimeMismatch > 0
                  ? ` · ${d.integrity.photoGeoMismatch + d.integrity.photoTimeMismatch} flagged`
                  : ""}
              </span>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {d.sections.map((section) => (
          <SectionBlock key={section.code} section={section} detail={d} />
        ))}
      </div>

      {d.reviewNotes && (
        <Card className="mt-4">
          <CardBody className="text-sm">
            <span className="font-medium text-midnight">Review notes: </span>
            <span className="text-zinc-600">{d.reviewNotes}</span>
          </CardBody>
        </Card>
      )}

      {/* Decision bar */}
      {!decided && (
        <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            {returning ? (
              <>
                <input
                  autoFocus
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What needs fixing? (required)"
                  className="h-9 flex-1 rounded-md ring-1 ring-inset ring-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-accent"
                />
                <Button variant="ghost" onClick={() => setReturning(false)}>
                  <X className="mr-1 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={notes.trim().length < 3 || decide.isPending}
                  onClick={() => decide.mutate("needs_revision")}
                >
                  Return for revision
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setReturning(true)} disabled={decide.isPending}>
                  <Ban className="mr-1.5 h-4 w-4" />
                  Return
                </Button>
                <Button className="ml-auto" onClick={() => decide.mutate("approve")} disabled={decide.isPending}>
                  {decide.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                  Approve
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionBlock({ section, detail }: { section: SubmissionDetail["sections"][number]; detail: SubmissionDetail }) {
  const tmpl = detail.template.sections.find((s) => s.code === section.code);
  const label = (code: string) => tmpl?.items.find((i) => i.code === code)?.label ?? code;
  return (
    <Card>
      <CardBody>
        <h3 className="mb-3 text-sm font-semibold text-midnight">{tmpl?.name ?? section.code}</h3>
        <div className="divide-y divide-zinc-100">
          {section.items.map((item) => (
            <ItemBlock key={item.itemCode} item={item} label={label(item.itemCode)} detail={detail} />
          ))}
        </div>
        {section.note && (
          <div className="mt-3 rounded-md bg-zinc-50 p-2 text-xs text-zinc-600">
            <span className="font-medium">Section note: </span>
            {section.note}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ItemBlock({
  item,
  label,
  detail,
}: {
  item: ItemResponse;
  label: string;
  detail: SubmissionDetail;
}) {
  const v = (item.value ?? "na") as Exclude<ItemValue, null>;
  const ui = VALUE_UI[v] ?? VALUE_UI.na;
  const photos = detail.photosByItem[item.itemCode] ?? [];
  return (
    <div className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-[11px] text-zinc-400">{item.itemCode}</span>
          <div className="text-sm text-midnight">{label}</div>
        </div>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold", ui.cls)}>
          {ui.label}
        </span>
      </div>
      {(item.reason || item.note) && (
        <div className="mt-1 space-y-0.5 text-xs text-zinc-600">
          {item.reason && <div><span className="text-zinc-400">Reason:</span> {item.reason}</div>}
          {item.note && <div><span className="text-zinc-400">Note:</span> {item.note}</div>}
        </div>
      )}
      {photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((p) =>
            p.url ? (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt="" className="h-16 w-16 rounded-md object-cover ring-1 ring-zinc-200" />
              </a>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to review
    </button>
  );
}
