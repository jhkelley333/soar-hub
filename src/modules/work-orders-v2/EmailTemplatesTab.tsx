// Email Templates tab — admin-only. One row per known event kind from
// EMAIL_TEMPLATE_KINDS. Edit modal renders a live preview in an iframe
// (srcDoc) using the same {{var}} substitution the backend uses, with
// a sample ticket payload baked in.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Pencil, X } from "lucide-react";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import {
  fetchEmailTemplates,
  saveEmailTemplate,
} from "./api";
import {
  EMAIL_TEMPLATE_KINDS,
  TEMPLATE_VARS,
  type EmailTemplate,
} from "./types";

// Sample data used for the live preview pane. Mirrors the shape of
// buildTicketVars on the backend so what you see is what gets sent.
const SAMPLE_VARS: Record<string, string> = {
  wo_number: "WO-1082-001",
  store_number: "1082",
  store_name: "Test Store",
  asset_type: "Fryer",
  category: "Equipment Type",
  priority: "Urgent",
  status: "Pending Approval",
  issue_description: "Fryer #2 won't heat. Vendor pre-checked.\nSecond line for testing.",
  approval_level: "SDO $501-$1000",
  approval_request_notes: "Replace heating element. Quote attached.",
  approval_status: "Approved",
  approval_approved_by: "Jane Approver",
  submitted_by: "GM Test",
  is_business_critical: "No",
  link: "https://example.com/admin/work-orders-v2",
};

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Same substitution rule the backend uses: unknown {{vars}} stay as-is
// so typos are visible in the preview.
function renderTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined ? `{{${key}}}` : escapeHtml(v);
  });
}

export function EmailTemplatesTab() {
  const toast = useToast();
  const qc = useQueryClient();

  const templatesQ = useQuery({
    queryKey: ["wo2", "emailTemplates"],
    queryFn: fetchEmailTemplates,
    staleTime: 60_000,
  });

  const [editing, setEditing] = useState<EmailTemplate | { kind: string } | null>(null);

  const byKind = useMemo(() => {
    const m = new Map<string, EmailTemplate>();
    for (const t of templatesQ.data?.templates ?? []) m.set(t.kind, t);
    return m;
  }, [templatesQ.data]);

  return (
    <>
      <div className="mb-4 text-xs text-zinc-500">
        Admin-editable email templates. Each event renders its template with
        <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 text-[11px]">{`{{variable}}`}</code>
        substitution. Toggle a template off to fall back to a hardcoded default.
      </div>

      {templatesQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {templatesQ.isError && (
        <EmptyState
          title="Couldn't load templates"
          description={(templatesQ.error as Error)?.message ?? "Try again."}
        />
      )}

      <div className="space-y-3">
        {EMAIL_TEMPLATE_KINDS.map(({ kind, label }) => {
          const tmpl = byKind.get(kind);
          return (
            <Card key={kind}>
              <CardBody className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-zinc-400" strokeWidth={1.75} />
                    <div className="text-sm font-semibold text-midnight">{label}</div>
                    {tmpl ? (
                      tmpl.is_active
                        ? <Badge tone="success">Active</Badge>
                        : <Badge tone="neutral">Off (using fallback)</Badge>
                    ) : (
                      <Badge tone="warning">Not seeded</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    kind: <code>{kind}</code>
                  </div>
                  <div className="mt-1 truncate text-xs text-zinc-700">
                    <span className="text-zinc-500">Subject: </span>
                    {tmpl?.subject || <span className="italic text-zinc-400">— using hardcoded default —</span>}
                  </div>
                  {tmpl?.updated_at && (
                    <div className="mt-0.5 text-[10px] text-zinc-400">
                      Last edited {new Date(tmpl.updated_at).toLocaleString()}
                      {tmpl.updated_by ? ` by ${tmpl.updated_by}` : ""}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  onClick={() => setEditing(tmpl ?? { kind })}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                  Edit
                </Button>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {editing !== null && (
        <TemplateEditModal
          template={"id" in editing ? editing : null}
          kind={editing.kind}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.push("Template saved.", "success");
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["wo2", "emailTemplates"] });
          }}
          onError={(msg) => toast.push(msg, "error")}
        />
      )}
    </>
  );
}

function TemplateEditModal({
  template,
  kind,
  onClose,
  onSaved,
  onError,
}: {
  template: EmailTemplate | null;
  kind: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [subject, setSubject] = useState(template?.subject || "");
  const [bodyHtml, setBodyHtml] = useState(template?.body_html || "");
  const [active, setActive] = useState(template?.is_active ?? true);

  const renderedSubject = renderTemplate(subject, SAMPLE_VARS);
  const renderedHtml = renderTemplate(bodyHtml, SAMPLE_VARS);

  const mut = useMutation({
    mutationFn: () => {
      if (!subject.trim()) return Promise.reject(new Error("Subject is required."));
      if (!bodyHtml.trim()) return Promise.reject(new Error("Body HTML is required."));
      return saveEmailTemplate({
        kind,
        subject,
        body_html: bodyHtml,
        is_active: active,
      });
    },
    onSuccess: onSaved,
    onError: (e: unknown) =>
      onError(e instanceof Error ? e.message : "Save failed."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-midnight">
            Edit template: <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm">{kind}</code>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 py-4 lg:grid-cols-2">
          {/* Editor side */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="tmpl-subject">Subject</Label>
              <Input
                id="tmpl-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="[Work Order] New {{wo_number}} — Store {{store_number}}"
              />
            </div>
            <div>
              <Label htmlFor="tmpl-body">Body HTML</Label>
              <textarea
                id="tmpl-body"
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                rows={16}
                className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              Active — when off, the function uses the hardcoded fallback.
            </label>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Available Variables
              </div>
              <div className="flex flex-wrap gap-1">
                {TEMPLATE_VARS.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    title={v.label}
                    onClick={() => {
                      // Append at end of body textarea on click — quick
                      // way to insert without fiddling with cursor pos.
                      setBodyHtml((prev) => prev + `{{${v.name}}}`);
                    }}
                    className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 hover:border-accent hover:text-accent"
                  >
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-zinc-400">
                Click a variable to append it to the body.
              </div>
            </div>
          </div>

          {/* Preview side */}
          <div className="flex flex-col space-y-2">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Subject (preview)
              </div>
              <div className="mt-0.5 text-sm font-medium text-midnight">
                {renderedSubject || <span className="italic text-zinc-400">—</span>}
              </div>
            </div>
            <div className="flex-1 overflow-hidden rounded-md border border-zinc-200 bg-white">
              <div className="border-b border-zinc-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Body (preview)
              </div>
              <iframe
                title="email preview"
                srcDoc={renderedHtml}
                sandbox=""
                className="h-[420px] w-full"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save Template
          </Button>
        </div>
      </div>
    </div>
  );
}
