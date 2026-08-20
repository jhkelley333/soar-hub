import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Sparkles, RefreshCw, ListChecks, GitCompareArrows } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS } from "@/types/database";
import { TraitChip } from "./TraitChip";
import {
  fetchTeam,
  fetchCachedPlaybook,
  generatePlaybook,
  type PlaybookContent,
  type PlaybookMember,
  type PlaybookProgress,
} from "./playbookApi";

const LARGE_TEAM = 40; // above this, a whole-team generation is too big — pick a region

export function DoPlaybookPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const teamQ = useQuery({ queryKey: ["trait-team"], queryFn: fetchTeam });
  const [region, setRegion] = useState<string>("");
  const [content, setContent] = useState<PlaybookContent | null>(null);
  const [meta, setMeta] = useState<{ cached: boolean; generatedAt: string } | null>(null);
  const [progress, setProgress] = useState<PlaybookProgress | null>(null);

  const coachMut = useMutation({
    mutationFn: (force: boolean) => {
      setProgress(null);
      return generatePlaybook(force, region, (tick) => {
        // Live: partial coaching + "coached X of Y" as each batch lands.
        setContent(tick.content);
        setProgress(tick.progress);
      });
    },
    onSuccess: (data) => {
      setContent(data.content);
      setMeta({ cached: data.cached, generatedAt: data.generatedAt });
      setProgress(null);
    },
    onSettled: () => setProgress(null),
  });

  const allMembers = teamQ.data?.members ?? [];
  const regions = teamQ.data?.regions ?? [];
  const members = region ? allMembers.filter((m) => m.region === region) : allMembers;

  // A big whole-team view is too much for one generation — default to the first
  // region so the initial scope is manageable.
  useEffect(() => {
    if (teamQ.data && !region && regions.length > 1 && allMembers.length > LARGE_TEAM) {
      setRegion(regions[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamQ.data]);

  // On region change, load that region's saved playbook if one exists (no
  // generation, no re-bill); otherwise clear so the button offers to generate.
  useEffect(() => {
    if (!teamQ.data) return;
    let cancelled = false;
    setContent(null);
    setMeta(null);
    setProgress(null);
    fetchCachedPlaybook(region).then((r) => {
      if (cancelled || !r) return;
      setContent(r.content);
      setMeta({ cached: r.cached, generatedAt: r.generatedAt });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, teamQ.data]);

  const coachingById = new Map((content?.members ?? []).map((m) => [m.id, m.coaching]));

  return (
    <>
      <PageHeader
        title="Team Playbook"
        description="How to lead your team, one person at a time — grounded in each leader's Culture Index profile."
        actions={
          allMembers.length > 0 ? (
            <div className="flex items-center gap-2">
              {content && isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => coachMut.mutate(true)}
                  disabled={coachMut.isPending}
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
                  Regenerate
                </Button>
              )}
              {!content && (
                <Button onClick={() => coachMut.mutate(false)} disabled={coachMut.isPending}>
                  <Sparkles className="mr-1 h-4 w-4" strokeWidth={2} />
                  {coachMut.isPending
                    ? "Generating…"
                    : region
                      ? `Generate for ${region}`
                      : "Generate coaching"}
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {teamQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {teamQ.isError && (
        <Card><CardBody>
          <p className="text-sm text-red-600">
            {teamQ.error instanceof Error ? teamQ.error.message : "Couldn't load your team."}
          </p>
        </CardBody></Card>
      )}

      {teamQ.data && allMembers.length === 0 && (
        <EmptyState
          title="No Culture Index traits on your team yet"
          description="Once your team members have a Culture Index trait, their coaching shows up here."
          action={
            <Link to="/admin/cultural-index-import">
              <Button variant="secondary" size="sm">Import Culture Index results</Button>
            </Link>
          }
        />
      )}

      {teamQ.data && allMembers.length > 0 && (
        <div className="space-y-6">
          {/* Team composition — always shown, even before coaching is generated. */}
          <Card>
            <CardHeader
              title={`${region || "Whole team"} · ${members.length}`}
              description={
                regions.length > 1
                  ? "Coach one region at a time — a whole-org generation is too large."
                  : "Every direct/downline leader who carries a Culture Index profile."
              }
              actions={
                regions.length > 1 ? (
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="rounded-md border-0 bg-surface px-3 py-1.5 text-sm text-heading ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="">All regions ({allMembers.length})</option>
                    {regions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                ) : undefined
              }
            />
            <CardBody className="p-0">
              <div className="divide-y divide-border">
                {members.map((m) => (
                  <MemberRow key={m.id} m={m} coaching={coachingById.get(m.id)} />
                ))}
              </div>
            </CardBody>
          </Card>

          {coachMut.isPending && (
            <Card><CardBody>
              <div className="flex items-center gap-3 text-sm text-ink-muted">
                <Sparkles className="h-4 w-4 animate-pulse text-accent" strokeWidth={2} />
                {progress && progress.total > 0
                  ? `Coaching your team in batches — ${progress.coached} of ${progress.total} done…`
                  : "Reading each profile and writing your coaching… this runs in the background."}
              </div>
              {progress && progress.total > 0 && (
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((progress.coached / progress.total) * 100))}%` }}
                  />
                </div>
              )}
            </CardBody></Card>
          )}

          {coachMut.isError && (
            <Card><CardBody>
              <p className="text-sm text-red-600">
                {coachMut.error instanceof Error ? coachMut.error.message : "Generation failed."}
              </p>
            </CardBody></Card>
          )}

          {content && content.overview && (
            <>
              <Card>
                <CardHeader
                  title="How to lead this team"
                  actions={
                    meta && (
                      <Badge tone="neutral" className="text-[10px]">
                        {meta.cached ? "Saved" : "Fresh"} · {new Date(meta.generatedAt).toLocaleDateString()}
                      </Badge>
                    )
                  }
                />
                <CardBody>
                  <p className="text-sm leading-relaxed text-ink-muted">{content.overview}</p>
                  {content.truncated && (
                    <p className="mt-2 text-xs text-amber-700">
                      Large team — coached the first {content.coached_count} of {content.team_count}.
                      Narrow your view or coach in groups for the rest.
                    </p>
                  )}
                </CardBody>
              </Card>

              {content.dynamics && (
                <Card>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-2">
                        <GitCompareArrows className="h-4 w-4 text-accent" strokeWidth={2} />
                        Team dynamics
                      </span>
                    }
                  />
                  <CardBody>
                    <p className="text-sm leading-relaxed text-ink-muted">{content.dynamics}</p>
                  </CardBody>
                </Card>
              )}

              {content.actions.length > 0 && (
                <Card>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-2">
                        <ListChecks className="h-4 w-4 text-accent" strokeWidth={2} />
                        This week
                      </span>
                    }
                  />
                  <CardBody>
                    <ul className="space-y-2">
                      {content.actions.map((a, i) => (
                        <li key={i} className="flex gap-2.5 text-sm text-ink-muted">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
                            {i + 1}
                          </span>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}

              <p className="px-1 text-[11px] leading-relaxed text-zinc-400">
                Coaching is generated from each person's Culture Index profile as context — defaults,
                not a verdict on ability. Use it as a starting point, not a label.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}

function MemberRow({ m, coaching }: { m: PlaybookMember; coaching?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-heading">{m.name}</span>
        <Badge tone="neutral" className="text-[10px]">{ROLE_LABELS[m.role]}</Badge>
        {m.store_number && (
          <span className="text-xs text-zinc-400">
            #{m.store_number}{m.store_name ? ` · ${m.store_name}` : ""}
          </span>
        )}
        <span className="ml-auto"><TraitChip trait={m.trait} size="xs" /></span>
      </div>
      {coaching && (
        <p className="mt-2 border-l-2 border-accent/30 pl-3 text-sm leading-relaxed text-ink-muted">
          {coaching}
        </p>
      )}
    </div>
  );
}
