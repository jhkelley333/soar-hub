// /reno-scoping/:id — tabbed scope editor. PR 2a ships the page shell
// with a header (store info, status, cohort, building type, submit /
// review action buttons) and the four tab placeholders. PR 2b will
// flesh out Checklist, Photos, and Review. Notes is implemented here
// because it's a single-textarea / append-only feed.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Image as ImageIcon,
  MessageSquare,
  RotateCcw,
  Send,
  Shield,
  Trash2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { useAuth } from "@/auth/AuthProvider";
import { roleLevel } from "@/types/database";
import { cn } from "@/lib/cn";
import {
  addScopeNote,
  deleteScope,
  fetchScope,
  fetchScopeNotes,
  transitionScopeStatus,
} from "./api";
import { NotesTab } from "./NotesTab";
import {
  BUILDING_TYPE_LABELS,
  COHORT_LABELS,
  STATUS_LABELS,
  type ScopeStatus,
} from "./types";

type Tab = "checklist" | "photos" | "notes" | "review";

const STATUS_BADGE: Record<ScopeStatus, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  submitted: "info",
  needs_revision: "warning",
  reviewed: "info",
  approved: "success",
};

export function ScopeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("checklist");

  const scopeQuery = useQuery({
    queryKey: ["reno-scope", id],
    queryFn: () => fetchScope(id!),
    enabled: !!id,
  });

  const notesQuery = useQuery({
    queryKey: ["reno-scope-notes", id],
    queryFn: () => fetchScopeNotes(id!),
    enabled: !!id,
  });

  const transitionMutation = useMutation({
    mutationFn: (args: { to: ScopeStatus; notes?: string | null }) =>
      transitionScopeStatus(id!, args.to, args.notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reno-scope", id] });
      queryClient.invalidateQueries({ queryKey: ["reno-scopes"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteScope(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reno-scopes"] });
      navigate("/reno-scoping");
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: (text: string) => addScopeNote(id!, text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reno-scope-notes", id] }),
  });

  if (scopeQuery.isLoading) {
    return (
      <>
        <PageHeader title="Loading…" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }
  if (scopeQuery.isError || !scopeQuery.data) {
    return (
      <>
        <PageHeader title="Scope" />
        <EmptyState
          title="Couldn't load scope"
          description={(scopeQuery.error as Error)?.message ?? "Try again."}
        />
      </>
    );
  }

  const scope = scopeQuery.data;
  const callerLevel = profile ? roleLevel(profile.role) : null;
  const isReviewer = callerLevel != null && callerLevel >= 30; // DO+
  const isScoper = profile?.id === scope.scoped_by;
  const canEdit = (isScoper && (scope.status === "draft" || scope.status === "needs_revision")) || isReviewer;
  const canSubmit = isScoper && (scope.status === "draft" || scope.status === "needs_revision");
  const canDelete = isScoper && scope.status === "draft";

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span>{scope.store?.number ?? "—"}</span>
            <span className="font-normal text-zinc-500">{scope.store?.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Badge tone={STATUS_BADGE[scope.status]}>{STATUS_LABELS[scope.status]}</Badge>
            <span>{BUILDING_TYPE_LABELS[scope.building_type]}</span>
            {scope.cohort && <span>· {COHORT_LABELS[scope.cohort]}</span>}
            <span>· scoped {scope.scope_date}</span>
            {scope.scoper?.full_name && <span>· by {scope.scoper.full_name}</span>}
          </span>
        }
        actions={
          <Link to="/reno-scoping">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
              Back
            </Button>
          </Link>
        }
      />

      {scope.status === "needs_revision" && scope.review_notes && (
        <Card className="mb-4 bg-amber-50 ring-amber-200">
          <div className="p-3 text-sm text-amber-900">
            <p className="font-semibold">Reviewer notes</p>
            <p className="mt-1 whitespace-pre-wrap">{scope.review_notes}</p>
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 p-3">
          {canSubmit && (
            <Button
              size="sm"
              onClick={() => transitionMutation.mutate({ to: "submitted" })}
              disabled={transitionMutation.isPending}
            >
              <Send className="h-3.5 w-3.5" strokeWidth={2} />
              Submit for review
            </Button>
          )}
          {isReviewer && scope.status === "submitted" && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const notes = window.prompt("Notes for the scoper (optional):", "");
                  transitionMutation.mutate({ to: "needs_revision", notes });
                }}
                disabled={transitionMutation.isPending}
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                Needs revision
              </Button>
              <Button
                size="sm"
                onClick={() => transitionMutation.mutate({ to: "approved", notes: null })}
                disabled={transitionMutation.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                Approve
              </Button>
            </>
          )}
          {isReviewer && scope.status === "approved" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => transitionMutation.mutate({ to: "submitted", notes: null })}
              disabled={transitionMutation.isPending}
            >
              <Shield className="h-3.5 w-3.5" strokeWidth={2} />
              Reopen review
            </Button>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              onClick={() => {
                if (window.confirm("Delete this draft scope? This cannot be undone.")) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Delete draft
            </Button>
          )}
        </div>
        {transitionMutation.isError && (
          <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {(transitionMutation.error as Error)?.message ?? "Status change failed."}
          </div>
        )}
      </Card>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-md bg-zinc-100 p-1">
        <TabButton active={tab === "checklist"} onClick={() => setTab("checklist")} icon={ClipboardList}>
          Checklist
        </TabButton>
        <TabButton active={tab === "photos"} onClick={() => setTab("photos")} icon={ImageIcon}>
          Photos
        </TabButton>
        <TabButton active={tab === "notes"} onClick={() => setTab("notes")} icon={MessageSquare}>
          Notes
        </TabButton>
        <TabButton active={tab === "review"} onClick={() => setTab("review")} icon={Shield}>
          Review
        </TabButton>
      </div>

      {tab === "checklist" && <ChecklistStub />}
      {tab === "photos" && <PhotosStub />}
      {tab === "notes" && (
        <NotesTab
          notes={notesQuery.data ?? []}
          loading={notesQuery.isLoading}
          canAdd={canEdit}
          onAdd={(text) => addNoteMutation.mutateAsync(text)}
          adding={addNoteMutation.isPending}
        />
      )}
      {tab === "review" && <ReviewStub />}
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof ClipboardList;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition",
        active ? "bg-white text-midnight shadow-sm" : "text-zinc-600 hover:text-midnight",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      {children}
    </button>
  );
}

function ChecklistStub() {
  return (
    <Card>
      <div className="space-y-2 p-6 text-center text-sm text-zinc-500">
        <ClipboardList className="mx-auto h-8 w-8 text-zinc-300" strokeWidth={1.5} />
        <p className="font-medium text-zinc-700">Checklist UI ships in the next push.</p>
        <p>27 items grouped by tier (Existing / Minimum / Plus-Up / Optional) with status, notes, and per-item photos.</p>
      </div>
    </Card>
  );
}

function PhotosStub() {
  return (
    <Card>
      <div className="space-y-2 p-6 text-center text-sm text-zinc-500">
        <ImageIcon className="mx-auto h-8 w-8 text-zinc-300" strokeWidth={1.5} />
        <p className="font-medium text-zinc-700">Photo upload ships in the next push.</p>
        <p>10 required named slots + 8 generic overflow + ad-hoc item photos. Client-side compression + EXIF taken_at.</p>
      </div>
    </Card>
  );
}

function ReviewStub() {
  return (
    <Card>
      <div className="space-y-2 p-6 text-center text-sm text-zinc-500">
        <XCircle className="mx-auto h-8 w-8 text-zinc-300" strokeWidth={1.5} />
        <p className="font-medium text-zinc-700">Review summary ships in the next push.</p>
        <p>Per-tier completion, fail/needs-work rollup, missing required photos, and an export-to-PDF button.</p>
      </div>
    </Card>
  );
}
