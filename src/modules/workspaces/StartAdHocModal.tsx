// StartAdHocModal — picker for self-starting a form/audit.
//
// Two-step flow: pick a self-serve template, pick a store, hit Start.
// Backend creates the assignment with the caller as assignee + the
// chosen store, status=in_progress, no due date. We then route to
// /assignments/:id/fill so the renderer can take over.
//
// Store list comes from /netlify/functions/org?action=my-tree, the
// same source that powers the My Stores page. That keeps the
// available stores aligned with the user's actual scope without us
// having to teach this modal anything about region/area/district
// hierarchy.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  X as XIcon, FileText, ClipboardCheck, MapPin, Loader2, Play, Search,
} from "lucide-react";
import { listSelfServeTemplates, startAdHocAssignment } from "./api";
import { fetchMyTree } from "@/modules/my-stores/api";
import type { WorkspaceTemplate } from "./types";

type Step = "template" | "store";

interface SelfServeTemplate extends WorkspaceTemplate {
  workspaces?: { id: string; name: string } | null;
  current_version: { id: string; template_id: string; version_number: number };
}

interface StoreOption {
  id: string;
  number: string;
  name: string | null;
  city: string | null;
  state: string | null;
}

export function StartAdHocModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("template");
  const [selectedTemplate, setSelectedTemplate] = useState<SelfServeTemplate | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tplQuery = useQuery({
    queryKey: ["self-serve-templates"],
    queryFn: () => listSelfServeTemplates(),
  });

  // Lazily load stores only once the user advances to step 2 — the
  // org tree is a heavier fetch than the template list and most users
  // will be picking before they realize they need it.
  const treeQuery = useQuery({
    queryKey: ["my-tree"],
    queryFn: () => fetchMyTree(),
    enabled: step === "store",
  });

  // Flatten the region → area → district → store tree to a single
  // list, sorted by store number. Matches the way the user mentally
  // searches ("my stores by number") rather than browsing the hierarchy.
  const stores: StoreOption[] = useMemo(() => {
    const out: StoreOption[] = [];
    const tree = treeQuery.data;
    if (!tree) return out;
    for (const region of tree.regions) {
      for (const area of region.areas) {
        for (const district of area.districts) {
          for (const store of district.stores) {
            if (!store.is_active) continue;
            out.push({
              id: store.id,
              number: store.number,
              name: store.name,
              city: store.city,
              state: store.state,
            });
          }
        }
      }
    }
    out.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    return out;
  }, [treeQuery.data]);

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((s) =>
      s.number.toLowerCase().includes(q)
      || (s.name?.toLowerCase().includes(q) ?? false)
      || (s.city?.toLowerCase().includes(q) ?? false),
    );
  }, [stores, search]);

  const startMut = useMutation({
    mutationFn: () => startAdHocAssignment({
      template_id: selectedTemplate!.id,
      store_id: selectedStoreId!,
    }),
    onSuccess: (data) => {
      onClose();
      navigate(`/assignments/${data.assignment.id}/fill`);
    },
    onError: (e) => setError((e as Error)?.message ?? "Couldn't start assignment."),
  });

  const templates = tplQuery.data?.templates ?? [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adhoc-title"
    >
      <div className="w-full sm:max-w-md bg-white sm:rounded-lg rounded-t-lg shadow-xl flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
          <h2 id="adhoc-title" className="text-base font-semibold text-gray-900 flex-1">
            {step === "template" ? "Pick a form or audit" : "Pick a store"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-md flex items-center justify-center text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-4 pt-2 pb-1 flex items-center gap-2 text-xs text-gray-500">
          <span className={step === "template" ? "font-semibold text-blue-700" : ""}>
            1. Template
          </span>
          <span>→</span>
          <span className={step === "store" ? "font-semibold text-blue-700" : ""}>
            2. Store
          </span>
        </div>

        {error && (
          <div className="mx-4 mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {step === "template" && (
            <TemplateList
              loading={tplQuery.isLoading}
              error={tplQuery.error as Error | null}
              templates={templates}
              selectedId={selectedTemplate?.id ?? null}
              onSelect={(t) => setSelectedTemplate(t)}
            />
          )}
          {step === "store" && (
            <StoreList
              loading={treeQuery.isLoading}
              error={treeQuery.error as Error | null}
              stores={filteredStores}
              search={search}
              onSearch={setSearch}
              selectedId={selectedStoreId}
              onSelect={setSelectedStoreId}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-2">
          {step === "template" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-11 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedTemplate}
                onClick={() => setStep("store")}
                className="flex-1 h-11 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500"
              >
                Next
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep("template")}
                disabled={startMut.isPending}
                className="flex-1 h-11 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!selectedStoreId || startMut.isPending}
                onClick={() => { setError(null); startMut.mutate(); }}
                className="flex-1 h-11 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500"
              >
                {startMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {startMut.isPending ? "Starting…" : "Start"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Template list ──────────────────────────────────

function TemplateList({
  loading, error, templates, selectedId, onSelect,
}: {
  loading: boolean;
  error: Error | null;
  templates: SelfServeTemplate[];
  selectedId: string | null;
  onSelect: (t: SelfServeTemplate) => void;
}) {
  if (loading) {
    return (
      <div className="p-4 space-y-2">
        <div className="h-12 bg-gray-100 rounded animate-pulse" />
        <div className="h-12 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }
  if (error) {
    return <div className="p-4 text-sm text-red-700">Failed to load templates: {error.message}</div>;
  }
  if (!templates.length) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        No self-serve forms or audits are available to you right now.
        Ask a workspace owner to flag a template as self-serve.
      </div>
    );
  }

  // Group by workspace so the list reads naturally for multi-workspace
  // users. Single-workspace users see one heading or none.
  const byWs = new Map<string, SelfServeTemplate[]>();
  for (const t of templates) {
    const wsName = t.workspaces?.name ?? "Workspace";
    const arr = byWs.get(wsName) ?? [];
    arr.push(t);
    byWs.set(wsName, arr);
  }
  const groups = Array.from(byWs.entries());

  return (
    <div className="p-2">
      {groups.map(([wsName, items]) => (
        <div key={wsName} className="mb-2">
          {groups.length > 1 && (
            <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-gray-500">
              {wsName}
            </div>
          )}
          <div className="space-y-1">
            {items.map((t) => {
              const Icon = t.type === "audit" ? ClipboardCheck : FileText;
              const isSelected = selectedId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t)}
                  className={
                    "w-full text-left px-3 py-2.5 rounded-md border flex items-start gap-3 transition focus:outline-none focus:ring-2 focus:ring-blue-500 " +
                    (isSelected
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300 bg-white")
                  }
                  aria-pressed={isSelected}
                >
                  <Icon className="h-4 w-4 text-gray-500 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{t.name}</div>
                    {t.description && (
                      <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{t.description}</div>
                    )}
                    <div className="text-[11px] text-gray-500 mt-0.5 uppercase tracking-wide">
                      {t.type} · v{t.current_version.version_number}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Store list ─────────────────────────────────────

function StoreList({
  loading, error, stores, search, onSearch, selectedId, onSelect,
}: {
  loading: boolean;
  error: Error | null;
  stores: StoreOption[];
  search: string;
  onSearch: (s: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="p-4 space-y-2">
        <div className="h-10 bg-gray-100 rounded animate-pulse" />
        <div className="h-12 bg-gray-100 rounded animate-pulse" />
        <div className="h-12 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }
  if (error) {
    return <div className="p-4 text-sm text-red-700">Failed to load stores: {error.message}</div>;
  }
  return (
    <div className="p-2 space-y-2">
      <div className="relative px-2">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by store number, name, or city"
          className="w-full h-11 rounded-md border border-gray-300 pl-9 pr-3 text-[15px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          aria-label="Search stores"
        />
      </div>
      {stores.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          {search ? "No stores match." : "No accessible stores."}
        </div>
      ) : (
        <div className="space-y-1">
          {stores.map((s) => {
            const isSelected = selectedId === s.id;
            const location = [s.city, s.state].filter(Boolean).join(", ");
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s.id)}
                className={
                  "w-full text-left px-3 py-2.5 rounded-md border flex items-start gap-3 transition focus:outline-none focus:ring-2 focus:ring-blue-500 " +
                  (isSelected
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 bg-white")
                }
                aria-pressed={isSelected}
              >
                <MapPin className="h-4 w-4 text-gray-500 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    #{s.number}
                    {s.name && <span className="text-gray-700"> · {s.name}</span>}
                  </div>
                  {location && (
                    <div className="text-xs text-gray-500 mt-0.5">{location}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
