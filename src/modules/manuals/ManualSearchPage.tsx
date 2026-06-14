// Manual & Guide Search — Phase 4. Search surface for all users. Debounced
// full-text query against search_manuals (RLS-scoped). Each hit shows the
// manual title, section path, a highlighted snippet, and the version badge so
// users always know which version they're reading.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Search } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { searchManuals, type ManualSearchHit } from "./api";

const MIN_CHARS = 2;

// Render a ts_headline snippet safely: split on the <mark> delimiters and let
// React escape everything else (no dangerouslySetInnerHTML).
function Snippet({ html }: { html: string }): ReactNode {
  const parts = useMemo(() => {
    const out: { text: string; mark: boolean }[] = [];
    const re = /<mark>([\s\S]*?)<\/mark>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (m.index > last) out.push({ text: html.slice(last, m.index), mark: false });
      out.push({ text: m[1], mark: true });
      last = re.lastIndex;
    }
    if (last < html.length) out.push({ text: html.slice(last), mark: false });
    return out;
  }, [html]);

  return (
    <p className="text-sm leading-relaxed text-ink-2">
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded bg-amber-200/70 px-0.5 text-heading">{p.text}</mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

export function ManualSearchPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const enabled = debounced.length >= MIN_CHARS;
  const query = useQuery({
    queryKey: ["manual-search", debounced],
    queryFn: () => searchManuals(debounced),
    enabled,
    staleTime: 30_000,
  });

  const results = (query.data ?? []) as ManualSearchHit[];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Manual & Guide Search"
        description="Search procedures across operations manuals and guides."
      />

      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search manuals — e.g. fryer cleaning, cash drop, opening checklist"
          className="pl-9"
          aria-label="Search manuals"
        />
      </div>

      {!enabled ? (
        <EmptyState
          title="Search the manuals"
          description="Type at least two characters to look up a procedure across your manuals and guides."
        />
      ) : query.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : query.isError ? (
        <EmptyState title="Couldn't run that search" description={(query.error as Error)?.message ?? "Try again in a moment."} />
      ) : results.length === 0 ? (
        <EmptyState title="No matches" description={`Nothing in your manuals matched “${debounced}”. Try different words.`} />
      ) : (
        <div className="space-y-3">
          <div className="text-xs font-medium text-ink-muted">{results.length} result{results.length === 1 ? "" : "s"}</div>
          {results.map((r) => (
            <Card key={r.chunk_id} className="p-4">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-heading">
                  <BookOpen className="h-4 w-4 text-accent" />
                  {r.manual_title}
                </span>
                {r.section_path && <span className="text-sm text-ink-muted">· {r.section_path}</span>}
                <Badge tone="neutral" className="ml-auto">Manual v{r.version_label}</Badge>
              </div>
              <Snippet html={r.snippet} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
