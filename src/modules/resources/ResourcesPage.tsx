// Resource library — Drive-backed file browser. Folder grid + file list
// + breadcrumb + debounced search, all in the app design system.

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, ExternalLink, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";

const FN = "/.netlify/functions/resources";

interface ResourceFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  icon: string;
  isFolder: boolean;
  modifiedTime?: string;
  size?: string | null;
}

interface FolderResponse {
  files: ResourceFile[];
  folderName: string;
  folderId?: string;
  isRoot?: boolean;
  ok?: false;
  message?: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: await authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { ok?: false }).ok === false) {
    throw new Error(
      (body as { message?: string }).message || `Request failed (${res.status})`,
    );
  }
  return body as T;
}

function fetchFolder(folderId: string | null): Promise<FolderResponse> {
  const url = folderId
    ? `${FN}?action=getFolder&folderId=${encodeURIComponent(folderId)}`
    : `${FN}?action=getFolder`;
  return fetchJSON<FolderResponse>(url);
}

function searchResources(q: string): Promise<FolderResponse> {
  return fetchJSON<FolderResponse>(`${FN}?action=search&q=${encodeURIComponent(q)}`);
}

interface NavCrumb { id: string | null; name: string }
const ROOT: NavCrumb = { id: null, name: "Resources" };

export function ResourcesPage() {
  const toast = useToast();
  // Breadcrumb-as-history: pushing into a folder appends a crumb;
  // clicking a crumb slices back to that depth. Beats wiring router
  // state for a single screen.
  const [searchParams] = useSearchParams();
  const [nav, setNav] = useState<NavCrumb[]>([ROOT]);
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
  const [debounced, setDebounced] = useState(() => (searchParams.get("q") ?? "").trim());

  // Same 400ms debounce the old HTML used. Avoids hammering Drive on
  // every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const current = nav[nav.length - 1];
  const isSearching = debounced.length > 0;

  const folderQ = useQuery({
    queryKey: ["resources-folder", current.id],
    queryFn: () => fetchFolder(current.id),
    enabled: !isSearching,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const searchQ = useQuery({
    queryKey: ["resources-search", debounced],
    queryFn: () => searchResources(debounced),
    enabled: isSearching,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const active = isSearching ? searchQ : folderQ;
  const data = active.data;
  const files = data?.files ?? [];
  const folders = files.filter((f) => f.isFolder);
  const docs = files.filter((f) => !f.isFolder);

  useEffect(() => {
    if (active.error) {
      toast.push(
        (active.error as Error).message || "Could not load resources.",
        "error",
      );
    }
  }, [active.error, toast]);

  const enterFolder = (f: ResourceFile) => {
    setNav((prev) => [...prev, { id: f.id, name: f.name }]);
    setSearchInput("");
  };

  const jumpTo = (i: number) => {
    setNav((prev) => prev.slice(0, i + 1));
    setSearchInput("");
  };

  return (
    <>
      <PageHeader
        title={isSearching ? `Search: ${debounced}` : current.name}
        description="SOPs, training, and reference docs from the Soar Drive."
      />

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
          strokeWidth={1.75}
        />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search files and folders…"
          className="pl-10 pr-10"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {!isSearching && nav.length > 1 && (
        <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
          {nav.map((c, i) => {
            const last = i === nav.length - 1;
            return (
              <span key={`${c.id ?? "root"}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-400" strokeWidth={1.75} />}
                {last ? (
                  <span className="font-semibold text-midnight">{c.name}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => jumpTo(i)}
                    className="text-zinc-500 hover:text-midnight hover:underline"
                  >
                    {c.name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {active.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {!active.isPending && !active.error && files.length === 0 && (
        <EmptyState
          title={isSearching ? "No matches" : "This folder is empty"}
          description={
            isSearching
              ? `Nothing found for "${debounced}".`
              : "Files added to this Drive folder will show up here."
          }
        />
      )}

      {active.isFetching && active.data && (
        <div className="mb-3 inline-flex items-center gap-1.5 text-xs text-zinc-500">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
          Refreshing…
        </div>
      )}

      {!active.isPending && folders.length > 0 && (
        <section className="mb-6">
          <SectionLabel>Folders</SectionLabel>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => enterFolder(f)}
                className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
              >
                <span className="text-2xl">{f.icon}</span>
                <span className="line-clamp-2 text-sm font-medium text-midnight">
                  {f.name}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!active.isPending && docs.length > 0 && (
        <section>
          <SectionLabel>Files</SectionLabel>
          <Card>
            <CardBody className="!p-0">
              <ul className="divide-y divide-zinc-100">
                {docs.map((f) => (
                  <li key={f.id}>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-zinc-50"
                    >
                      <span className="w-8 text-center text-xl">{f.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-midnight">
                          {f.name}
                        </span>
                        {f.modifiedTime && (
                          <span className="block text-[11px] text-zinc-500">
                            Modified{" "}
                            {new Date(f.modifiedTime).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        )}
                      </span>
                      <ExternalLink
                        className="h-4 w-4 text-zinc-400"
                        strokeWidth={1.75}
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </section>
      )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      <span>{children}</span>
      <span className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}
