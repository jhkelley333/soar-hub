// Walkthrough assignments — DO assigns walks to GMs, and tracks their status.
// Form + list on the scoped org tree (fetchMyTree) and active templates.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { Field, Select, TextInput } from "../builder/controls";
import { StatusChip } from "../review/tierUi";
import {
  createAssignment,
  listActiveTemplates,
  listAssignments,
  loadAssignStores,
  type AssignmentRow,
} from "./api";

export function AssignmentsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);

  const assignments = useQuery({ queryKey: ["wt-assignments"], queryFn: listAssignments });

  const newBtn = (
    <Button onClick={() => setShowForm((s) => !s)}>
      <Plus className="mr-1.5 h-4 w-4" />
      New assignment
    </Button>
  );

  const content = (
    <>
      {showForm && (
        <NewAssignmentForm
          onDone={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ["wt-assignments"] });
            toast.push("Assignment created", "success");
          }}
          onError={(m) => toast.push(m, "error")}
        />
      )}

      {assignments.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : assignments.error ? (
        <Card>
          <CardBody className="text-sm text-red-600">
            {assignments.error instanceof Error ? assignments.error.message : "Failed to load."}
          </CardBody>
        </Card>
      ) : !assignments.data?.length ? (
        <EmptyState title="No assignments yet" description="Create one to send a walk to a GM." />
      ) : (
        <div className="space-y-2">
          {assignments.data.map((a) => (
            <AssignmentCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <>
        <div className="mb-4 flex justify-end">{newBtn}</div>
        {content}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Walkthrough assignments"
        description="Assign walks to your GMs and track them through submission."
        actions={newBtn}
      />
      {content}
    </div>
  );
}

function NewAssignmentForm({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const templates = useQuery({ queryKey: ["wt-active-templates"], queryFn: listActiveTemplates });
  const stores = useQuery({ queryKey: ["wt-assign-stores"], queryFn: loadAssignStores });

  const [templateId, setTemplateId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [due, setDue] = useState("");

  const store = useMemo(
    () => stores.data?.find((s) => s.id === storeId),
    [stores.data, storeId],
  );

  const create = useMutation({
    mutationFn: () => {
      const tmpl = templates.data?.find((t) => t.id === templateId);
      return createAssignment({
        templateId,
        templateVersion: tmpl?.version ?? "",
        storeId,
        assigneeId,
        // End-of-day on the chosen date so "due today" isn't already overdue.
        dueAt: due ? new Date(`${due}T23:59:59`).toISOString() : null,
      });
    },
    onSuccess: onDone,
    onError: (e) => onError(e instanceof Error ? e.message : "Create failed"),
  });

  const ready = templateId && storeId && assigneeId;

  return (
    <Card className="mb-5">
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Template">
            <Select
              value={templateId}
              onChange={setTemplateId}
              options={[
                { value: "", label: templates.isLoading ? "Loading…" : "Select a template" },
                ...(templates.data ?? []).map((t) => ({ value: t.id, label: `${t.name} · v${t.version}` })),
              ]}
            />
          </Field>
          <Field label="Due date" hint="Optional.">
            <TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Store">
            <Select
              value={storeId}
              onChange={(v) => {
                setStoreId(v);
                setAssigneeId("");
              }}
              options={[
                { value: "", label: stores.isLoading ? "Loading…" : "Select a store" },
                ...(stores.data ?? []).map((s) => ({ value: s.id, label: `${s.number} · ${s.name}` })),
              ]}
            />
          </Field>
          <Field label="Assignee" hint={store && !store.assignees.length ? "No team on file for this store." : undefined}>
            <Select
              value={assigneeId}
              onChange={setAssigneeId}
              options={[
                { value: "", label: !store ? "Pick a store first" : "Select an assignee" },
                ...(store?.assignees ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.role})` })),
              ]}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button onClick={() => create.mutate()} disabled={!ready || create.isPending}>
            {create.isPending ? "Creating…" : "Create assignment"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function AssignmentCard({ a }: { a: AssignmentRow }) {
  const overdue = a.dueAt && new Date(a.dueAt) < new Date() && a.status !== "submitted";
  return (
    <Card>
      <CardBody className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-midnight">
              {a.storeNumber} · {a.storeName}
            </span>
            <StatusChip status={a.status} />
            <Badge tone="info">{a.templateName}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            <span>{a.assigneeName}</span>
            <span>v{a.templateVersion}</span>
            {a.dueAt && (
              <span className={overdue ? "inline-flex items-center gap-1 font-medium text-red-600" : "inline-flex items-center gap-1"}>
                <CalendarClock className="h-3 w-3" />
                Due {new Date(a.dueAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
