// Manual & Guide Search — Phase 5. Admin surface (RVP+/admin). Create manuals,
// upload new versions (→ Storage → doc_versions → ingest), activate the live
// version, and re-index. Upload is the entire update UX — no manual content
// entry. Reads/writes go through RLS (manual_can_manage gates writes).
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Plus, RefreshCw, Upload } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import {
  activateVersion, createManual, ingestVersion, listManualsAdmin, uploadVersion,
  type DocVersion, type Manual, type ManualScope,
} from "./api";

const SCOPES: ManualScope[] = ["company", "region", "area", "district", "store"];
const SELECT_CLS =
  "block w-full rounded-md border-0 bg-surface px-3 py-2 text-sm text-ink ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-accent";

export function ManualAdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["manuals-admin"], queryFn: listManualsAdmin });
  const refresh = () => qc.invalidateQueries({ queryKey: ["manuals-admin"] });

  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<ManualScope>("company");
  const [scopeRef, setScopeRef] = useState("");

  const create = useMutation({
    mutationFn: () => createManual({ title, description, scope, scope_ref: scopeRef }),
    onSuccess: () => {
      toast.push("Manual created.", "success");
      setShowNew(false); setTitle(""); setDescription(""); setScope("company"); setScopeRef("");
      refresh();
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't create manual.", "error"),
  });

  const versionsByManual = useMemo(() => {
    const map = new Map<string, DocVersion[]>();
    for (const v of q.data?.versions ?? []) {
      (map.get(v.manual_id) ?? map.set(v.manual_id, []).get(v.manual_id)!).push(v);
    }
    return map;
  }, [q.data]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Manuals — Admin"
        description="Create manuals and upload new versions. Uploading + activating a new version replaces what users search; the old version is retained."
        actions={<Button size="sm" onClick={() => setShowNew((s) => !s)}><Plus className="mr-1 h-3.5 w-3.5" />New manual</Button>}
      />

      {showNew && (
        <Card className="mb-6">
          <CardHeader title="New manual" />
          <CardBody className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Operations Manual" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Description (optional)</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Scope</label>
                <select value={scope} onChange={(e) => setScope(e.target.value as ManualScope)} className={SELECT_CLS}>
                  {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {scope !== "company" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-muted">{scope} ID (uuid)</label>
                  <Input value={scopeRef} onChange={(e) => setScopeRef(e.target.value)} placeholder="org id this manual is scoped to" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button size="sm" disabled={!title.trim() || (scope !== "company" && !scopeRef.trim()) || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "Creating…" : "Create manual"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {q.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load manuals" description={(q.error as Error)?.message ?? "Try again."} />
      ) : (q.data?.manuals.length ?? 0) === 0 ? (
        <EmptyState title="No manuals yet" description="Create a manual, then upload its first version." />
      ) : (
        <div className="space-y-4">
          {q.data!.manuals.map((m) => (
            <ManualCard key={m.id} manual={m} versions={versionsByManual.get(m.id) ?? []} onChange={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function ManualCard({ manual, versions, onChange }: { manual: Manual; versions: DocVersion[]; onChange: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: () => uploadVersion(manual.id, label, file!),
    onSuccess: (v) => { toast.push(`Version ${v.version_label} uploaded & indexed.`, "success"); setLabel(""); setFile(null); if (fileRef.current) fileRef.current.value = ""; onChange(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Upload failed.", "error"),
  });
  const activate = useMutation({
    mutationFn: (id: string) => activateVersion(id),
    onSuccess: () => { toast.push("Version activated — now live in search.", "success"); onChange(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Couldn't activate.", "error"),
  });
  const reindex = useMutation({
    mutationFn: (id: string) => ingestVersion(id),
    onSuccess: (r) => { toast.push(`Re-indexed (${r.chunks} sections).`, "success"); onChange(); },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Re-index failed.", "error"),
  });

  const onPick = (e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {manual.title}
            <Badge tone="neutral">{manual.scope}</Badge>
          </span>
        }
        description={manual.description ?? undefined}
      />
      <CardBody className="space-y-4">
        {/* version history */}
        {versions.length === 0 ? (
          <div className="text-sm text-ink-subtle">No versions yet — upload the first below.</div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <FileText className="h-4 w-4 text-ink-subtle" />
                <span className="font-semibold text-heading">v{v.version_label}</span>
                {v.is_active
                  ? <Badge tone="success" className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Active</Badge>
                  : <Badge tone="neutral">Inactive</Badge>}
                <span className="text-xs text-ink-muted">
                  {v.indexed_at ? "indexed" : "not indexed"} · uploaded {v.uploaded_at.slice(0, 10)}
                </span>
                <span className="ml-auto flex gap-2">
                  {!v.is_active && (
                    <Button size="sm" variant="secondary" disabled={!v.indexed_at || activate.isPending} onClick={() => activate.mutate(v.id)}>
                      Activate
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={reindex.isPending} onClick={() => reindex.mutate(v.id)}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />Re-index
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* upload new version */}
        <div className="rounded-lg border border-dashed border-border p-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Upload new version</div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Version label, e.g. 2026.2" className="w-40" />
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" onChange={onPick} className="text-sm text-ink-2" />
            <Button size="sm" className="ml-auto" disabled={!label.trim() || !file || upload.isPending} onClick={() => upload.mutate()}>
              <Upload className="mr-1 h-3.5 w-3.5" />{upload.isPending ? "Uploading…" : "Upload & index"}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-subtle">PDF. Uploading indexes the version (does not make it live). Hit Activate when ready.</p>
        </div>
      </CardBody>
    </Card>
  );
}
