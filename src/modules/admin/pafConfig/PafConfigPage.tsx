import { useEffect, useMemo, useState } from "react";
import { useBlocker } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, History, Save, Undo2 } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchPafConfig, savePafConfig } from "./api";
import { ListsEditor } from "./ListsEditor";
import { FieldsEditor } from "./FieldsEditor";
import { SectionsEditor } from "./SectionsEditor";
import { TemplatesEditor } from "./TemplatesEditor";
import { PreviewForm } from "./PreviewForm";
import { HistoryDrawer } from "./HistoryDrawer";
import type { PafFormConfig } from "./types";

type TabId = "lists" | "fields" | "sections" | "templates" | "preview";

const TABS: { id: TabId; label: string; description: string }[] = [
  { id: "lists", label: "Lists", description: "Categories, positions, statuses, etc." },
  { id: "fields", label: "Fields", description: "Labels, hints, required & visible" },
  { id: "sections", label: "Sections", description: "Headings, descriptions, order" },
  { id: "templates", label: "Email templates", description: "Subjects + bodies" },
  { id: "preview", label: "Preview", description: "See your unsaved draft" },
];

export function PafConfigPage() {
  const qc = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["paf-config"],
    queryFn: fetchPafConfig,
  });

  const [draft, setDraft] = useState<PafFormConfig | null>(null);
  const [tab, setTab] = useState<TabId>("lists");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the draft whenever a fresh config arrives (and we have no
  // unsaved edits yet).
  useEffect(() => {
    if (query.data && draft === null) {
      setDraft(query.data.config_json);
    }
  }, [query.data, draft]);

  const dirty = useMemo(() => {
    if (!query.data || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(query.data.config_json);
  }, [draft, query.data]);

  // Prompt before leaving with unsaved edits — same pattern as /account.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return dirty && currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (blocker.state === "blocked") {
      const ok = window.confirm(
        "You have unsaved changes to the PAF form config. Leave without saving?"
      );
      if (ok) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);

  // Auto-clear "Saved" badge.
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);

  async function onSave() {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      const summary = window.prompt(
        "Short summary of what changed (optional):",
        ""
      );
      // User canceled the prompt — abort the save.
      if (summary === null) {
        setSaving(false);
        return;
      }
      await savePafConfig(draft, summary || "");
      toast.push("Configuration saved.", "success");
      setSavedAt(Date.now());
      await qc.invalidateQueries({ queryKey: ["paf-config"] });
      await qc.invalidateQueries({ queryKey: ["paf-config-history"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      setError(msg);
      toast.push(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  function onDiscard() {
    if (!query.data) return;
    if (!dirty) return;
    if (!window.confirm("Discard all unsaved changes?")) return;
    setDraft(query.data.config_json);
  }

  function onRestored() {
    // After a restore, the latest version on the server is now the
    // restored copy. Refetch and let the useEffect re-hydrate.
    setDraft(null);
    qc.invalidateQueries({ queryKey: ["paf-config"] });
  }

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="PAF Configuration" description="Loading…" />
        <Skeleton className="h-32 w-full" />
      </>
    );
  }

  if (query.isError || !query.data || !draft) {
    return (
      <>
        <PageHeader title="PAF Configuration" />
        <EmptyState
          title="Couldn't load the PAF config"
          description={
            (query.error as Error)?.message ??
            "Make sure migration 0015 ran in Supabase."
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="PAF Configuration"
        description={
          <span>
            Currently on version{" "}
            <span className="font-mono font-medium text-zinc-700">
              v{query.data.config_version}
            </span>
            {dirty && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                Unsaved changes
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              History
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDiscard}
              disabled={!dirty || saving}
            >
              <Undo2 className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Discard
            </Button>
            {savedAt !== null && (
              <Badge tone="success" className="inline-flex items-center gap-1">
                <Check className="h-3 w-3" strokeWidth={2.5} />
                Saved
              </Badge>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={!dirty || saving}
            >
              <Save className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tab nav */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition",
              tab === t.id
                ? "bg-midnight text-white"
                : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:text-midnight"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Editor area */}
      <Card>
        <CardBody>
          {tab === "lists" && (
            <ListsEditor draft={draft} onChange={setDraft} />
          )}
          {tab === "fields" && (
            <FieldsEditor draft={draft} onChange={setDraft} />
          )}
          {tab === "sections" && (
            <SectionsEditor draft={draft} onChange={setDraft} />
          )}
          {tab === "templates" && (
            <TemplatesEditor draft={draft} onChange={setDraft} />
          )}
          {tab === "preview" && <PreviewForm draft={draft} />}
        </CardBody>
      </Card>

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestored={onRestored}
        currentVersion={query.data.config_version}
      />
    </>
  );
}
