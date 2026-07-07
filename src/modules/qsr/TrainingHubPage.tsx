// Training hub — the single home for everything training, consolidating what
// used to be four nav items (My Training, Team Training, Training QR Codes,
// Assessments) into one page with tabs, per the design mock:
//   header  ─ "Training" + greeting · course search · Training QR button
//   tabs    ─ My Training (outstanding badge) · Team Training · Assessments
//   my tab  ─ stat tiles (In progress / Due now / Completed / Badges),
//             "Continue learning" cards with category chip + progress bar +
//             due date + Resume/Start/Review, then the searchable catalog.
// Team Training and Assessments embed their existing pages (headers hidden).
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, BookOpenCheck, ClipboardCheck, QrCode, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/auth/AuthProvider";
import { fetchMyTraining, fetchQsrStats, type MyTrainingCourse } from "./api";
import { ManagerDashboardPage } from "./manage/ManagerDashboardPage";
import { NlaListPage } from "@/modules/nla/NlaListPage";
import { fetchNlaList } from "@/modules/nla/api";

type Tab = "my" | "team" | "assessments";

const TEAM_ROLES = new Set(["shift_manager", "associate_manager", "first_assistant_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin", "fbc"]);
const QR_ROLES = new Set(["shift_manager", "associate_manager", "first_assistant_manager", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
const NLA_ROLES = new Set(["shift_manager", "first_assistant_manager", "associate_manager", "crew_leader", "gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function TrainingHubPage() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");

  // Role-gated like the old sidebar entries (and the /qsr/manage + /qsr/share
  // route guards). The qsr_platform flag never gated role-qualifying users —
  // it only widens roles:[] modules — so it does not apply here.
  const role = String(profile?.role ?? "");
  const showTeam = TEAM_ROLES.has(role);
  const showQr = QR_ROLES.has(role);
  const showNla = NLA_ROLES.has(role);

  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw === "team" && showTeam ? "team" : raw === "assessments" && showNla ? "assessments" : "my";
  const setTab = (t: Tab) => setParams(t === "my" ? {} : { tab: t }, { replace: true });

  // Badge counts. My Training = required courses still outstanding this window;
  // Assessments = ones awaiting the caller's rating.
  const trainQ = useQuery({ queryKey: ["qsr-my-training"], queryFn: fetchMyTraining, staleTime: 60_000 });
  const nlaQ = useQuery({ queryKey: ["nla-list"], queryFn: fetchNlaList, staleTime: 60_000, enabled: showNla });
  const courses = trainQ.data?.courses ?? [];
  const outstanding = courses.filter((c) => c.outstanding).length;
  const needsRating = (nlaQ.data?.assessments ?? []).filter((a) => a.my_role && !a.my_submitted && a.status === "awaiting_responses").length;

  const first = (profile?.preferred_name || profile?.full_name || "").trim().split(/\s+/)[0] || "there";

  return (
    <div className="mx-auto max-w-6xl">
      {/* ── header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink">Training</h1>
          <p className="mt-0.5 text-sm text-ink-muted">{greeting()}, {first}</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "my" && (
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search courses"
                className="w-52 rounded-xl border border-border bg-surface-sunk py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus:border-qsr-azure focus:bg-surface focus:outline-none sm:w-64"
              />
            </label>
          )}
          {showQr && (
            <Link to="/qsr/share" className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-qsr-azure">
              <QrCode className="h-4 w-4 text-qsr-azure" /> Training QR
            </Link>
          )}
        </div>
      </div>

      {/* ── tabs ── */}
      <div className="mt-4 border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          <TabButton on={tab === "my"} onClick={() => setTab("my")} icon={<BookOpenCheck className="h-4 w-4" />} label="My Training" count={outstanding} />
          {showTeam && <TabButton on={tab === "team"} onClick={() => setTab("team")} icon={<BarChart3 className="h-4 w-4" />} label="Team Training" />}
          {showNla && <TabButton on={tab === "assessments"} onClick={() => setTab("assessments")} icon={<ClipboardCheck className="h-4 w-4" />} label="Assessments" count={needsRating} />}
        </div>
      </div>

      {/* ── panels ── */}
      <div className="mt-6">
        {tab === "my" && <MyTrainingPanel loading={trainQ.isLoading} error={trainQ.isError} courses={courses} search={search} />}
        {tab === "team" && showTeam && <ManagerDashboardPage embedded />}
        {tab === "assessments" && showNla && <NlaListPage embedded />}
      </div>
    </div>
  );
}

function TabButton({ on, onClick, icon, label, count }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition",
        on ? "border-qsr-azure text-qsr-azure" : "border-transparent text-ink-muted hover:text-ink",
      )}
    >
      {icon}{label}
      {count != null && count > 0 && (
        <span className={cn("grid h-5 min-w-[1.25rem] place-items-center rounded-full px-1 text-[11px] font-bold",
          on ? "bg-qsr-azure/10 text-qsr-azure" : "bg-amber-100 text-amber-800")}>{count}</span>
      )}
    </button>
  );
}

// ── My Training (redesigned to the mock) ─────────────────────────────────────

function MyTrainingPanel({ loading, error, courses, search }: {
  loading: boolean; error: boolean; courses: MyTrainingCourse[]; search: string;
}) {
  const statsQ = useQuery({ queryKey: ["qsr-stats"], queryFn: fetchQsrStats, staleTime: 60_000 });

  const inProgress = courses.filter((c) => c.status === "in_progress").length;
  const dueNow = courses.filter((c) => c.outstanding).length;
  const completed = courses.filter((c) => c.status === "completed").length;
  const badges = statsQ.data?.badges?.length ?? 0;

  const q = search.trim().toLowerCase();
  const match = (c: MyTrainingCourse) =>
    !q || c.title.toLowerCase().includes(q) || (c.category ?? "").toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q);

  // Continue learning = what's actionable: due-required first, then in-progress.
  const continueList = useMemo(() => {
    const seen = new Set<string>();
    const out: MyTrainingCourse[] = [];
    for (const c of courses) if (c.outstanding && match(c)) { out.push(c); seen.add(c.id); }
    for (const c of courses) if (c.status === "in_progress" && !seen.has(c.id) && match(c)) { out.push(c); seen.add(c.id); }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, q]);

  const catalog = courses.filter(match);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-sunk" />)}</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-surface-sunk" />)}</div>
      </div>
    );
  }
  if (error) {
    return <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-sm text-ink-muted">Couldn’t load training right now. Refresh to try again.</div>;
  }

  return (
    <div className="space-y-7">
      {/* stat tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile n={inProgress} label="In progress" tone="text-qsr-azure" />
        <StatTile n={dueNow} label="Due now" tone="text-amber-600" />
        <StatTile n={completed} label="Completed" tone="text-emerald-600" />
        <StatTile n={badges} label="Badges earned" tone="text-ink" />
      </div>

      {/* continue learning */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Continue learning</h2>
          <a href="#all-courses" className="text-sm font-semibold text-qsr-azure hover:underline">View all courses</a>
        </div>
        {continueList.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-sm text-ink-muted">
            {q ? "No matches — check the full catalog below." : "You're all caught up. Browse the catalog below to keep learning."}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {continueList.map((c) => <DesignCourseCard key={c.id} c={c} />)}
          </div>
        )}
      </div>

      {/* full catalog */}
      <div id="all-courses">
        <h2 className="mb-3 text-lg font-bold text-ink">All courses</h2>
        {catalog.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-sm text-ink-muted">
            {q ? `Nothing matches “${search.trim()}”.` : "No published courses yet. Check back soon."}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((c) => <DesignCourseCard key={c.id} c={c} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className={cn("text-3xl font-bold tabular-nums", tone)}>{n}</div>
      <div className="mt-0.5 text-sm text-ink-muted">{label}</div>
    </div>
  );
}

// Category chip color — keyed for the common categories, neutral otherwise.
function chipClass(category: string | null): string {
  const k = (category ?? "").toLowerCase();
  if (k.includes("compliance") || k.includes("safety")) return "bg-qsr-azure/10 text-qsr-azure";
  if (k.includes("skill") || k.includes("service")) return "bg-emerald-500/10 text-emerald-600";
  if (k.includes("leader")) return "bg-violet-500/10 text-violet-600";
  if (k.includes("ops") || k.includes("operation")) return "bg-amber-500/10 text-amber-700";
  return "bg-surface-sunk text-ink-muted";
}

const fmtDue = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function DesignCourseCard({ c }: { c: MyTrainingCourse }) {
  const navigate = useNavigate();
  const done = c.status === "completed";
  const pct = done ? 100 : c.status === "in_progress" ? (c.progress_pct ?? 10) : 0;
  const statusLabel = done ? "Completed" : c.status === "in_progress" ? "In progress" : "Not started";
  const cta = done ? "Review" : c.status === "in_progress" ? "Resume" : "Start";

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-4 transition hover:border-qsr-azure hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", chipClass(c.category))}>
          {c.category || "Course"}
        </span>
        {c.est_minutes != null && <span className="text-[11px] text-ink-subtle">~{c.est_minutes} min</span>}
      </div>

      <h3 className="mt-2.5 text-base font-bold leading-snug text-ink">{c.title}</h3>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[13px]">
          <span className={cn(done ? "font-medium text-ink" : "text-ink-muted")}>{statusLabel}</span>
          <span className={cn("font-semibold tabular-nums", done ? "text-ink" : "text-qsr-azure")}>{done ? "Done" : `${pct}%`}</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-sunk">
          <div className={cn("h-full rounded-full transition-all", done ? "bg-ink" : "bg-qsr-azure")} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between pt-4">
        {done ? (
          <span className="text-[13px] font-semibold text-emerald-600">Completed</span>
        ) : c.outstanding && c.due_date ? (
          <span className="text-[13px] font-semibold text-amber-600">Due {fmtDue(c.due_date)}</span>
        ) : (
          <span className="text-[13px] text-ink-subtle">{c.required ? "Required" : `+${c.points} pts`}</span>
        )}
        <button
          onClick={() => navigate(`/qsr/course/${c.id}`)}
          className={cn("rounded-lg px-4 py-1.5 text-sm font-semibold transition",
            done ? "border border-border bg-surface text-ink hover:bg-surface-sunk" : "bg-qsr-azure text-white hover:opacity-90")}
        >
          {cta}
        </button>
      </div>
    </div>
  );
}
