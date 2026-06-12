// Coaching Tool Kit — home / chooser. A definition hero banner, optional
// recently-used + favorites sections, then the full list of tools. Tapping a
// row opens the tool; the heart favorites it (without opening).
import { useNavigate } from "react-router-dom";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { TOOLS, TOOL_BY_ID, chipVars, type CoachTool, type ToolId } from "./types";
import { useCoachingStore } from "./storage";

const FAV = "#E06A55";

export function CoachingToolkitPage() {
  const nav = useNavigate();
  const { favorites, toggleFavorite, recent, pushRecent } = useCoachingStore();

  function open(id: ToolId) { pushRecent(id); nav(`/coaching/${id}`); }

  const favTools = favorites.map((id) => TOOL_BY_ID[id]).filter(Boolean);
  const recentTools = recent.map((id) => TOOL_BY_ID[id]).filter(Boolean);

  return (
    <div className="mx-auto max-w-2xl pb-10">
      {/* header */}
      <div className="mb-4">
        <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-accent">Coaching for Performance</div>
        <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-heading">Tool Kit</h1>
      </div>

      {/* definition hero */}
      <div className="relative mb-7 overflow-hidden rounded-2xl bg-midnight-900 p-6 text-frost-soft shadow-card">
        <span className="pointer-events-none absolute -top-6 right-3 select-none font-serif text-[140px] leading-none text-white/[0.06]">&rdquo;</span>
        <div className="relative font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">Coaching is</div>
        <p className="relative mt-3 text-lg font-medium leading-relaxed tracking-tight">
          "The art and science of <em className="not-italic" style={{ color: "#9FD9B8" }}>inspiring, energizing</em> and
          facilitating the performance, learning and development of a person — to get a <em className="not-italic" style={{ color: "#9FD9B8" }}>specific result</em>."
        </p>
        <div className="relative mt-4 flex flex-wrap gap-2">
          {["Inspire", "Energize", "Facilitate", "Develop"].map((t) => (
            <span key={t} className="rounded-full border border-white/20 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wide text-white/80">{t}</span>
          ))}
        </div>
      </div>

      {/* recently used */}
      {recentTools.length > 0 && (
        <section className="mb-6">
          <SectionLabel>Recently used</SectionLabel>
          <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recentTools.map((t) => {
              const { chip, soft } = chipVars(t.hue);
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => open(t.id)}
                  className="flex shrink-0 items-center gap-2.5 rounded-full border border-border bg-surface py-1.5 pl-1.5 pr-3.5 shadow-card transition active:scale-95">
                  <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: soft, color: chip }}>
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <span className="whitespace-nowrap text-[13px] font-semibold text-heading">{t.title}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* favorites */}
      {favTools.length > 0 && (
        <section className="mb-6">
          <SectionLabel>Favorites</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {favTools.map((t) => (
              <ToolRow key={t.id} tool={t} fav onOpen={() => open(t.id)} onFav={() => toggleFavorite(t.id)} />
            ))}
          </div>
        </section>
      )}

      {/* all tools */}
      <section>
        <SectionLabel>All tools · {TOOLS.length}</SectionLabel>
        <div className="flex flex-col gap-2.5">
          {TOOLS.map((t) => (
            <ToolRow key={t.id} tool={t} fav={favorites.includes(t.id)} onOpen={() => open(t.id)} onFav={() => toggleFavorite(t.id)} />
          ))}
        </div>
      </section>

      <p className="mt-8 text-center font-mono text-[10.5px] tracking-wide text-ink-subtle">Choose a card to begin. Right now.</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 ml-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">{children}</div>;
}

function ToolRow({ tool, fav, onOpen, onFav }: { tool: CoachTool; fav: boolean; onOpen: () => void; onFav: () => void }) {
  const { chip, soft } = chipVars(tool.hue);
  const Icon = tool.icon;
  return (
    <div
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="group flex cursor-pointer items-center gap-3.5 rounded-2xl border border-border bg-surface p-3.5 shadow-card transition hover:border-border-strong active:scale-[.985]">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ background: soft, color: chip }}>
        <Icon className="h-6 w-6" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em]" style={{ color: chip }}>{tool.category}</div>
        <div className="mt-0.5 truncate text-[16.5px] font-semibold tracking-tight text-heading">{tool.title}</div>
        <div className="truncate text-[12.5px] text-ink-muted">{tool.subtitle}</div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onFav(); }}
        aria-label={fav ? "Remove favorite" : "Add favorite"}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-subtle transition hover:bg-surface-sunk">
        <Heart className={cn("h-5 w-5", fav && "fill-current")} style={fav ? { color: FAV } : undefined} strokeWidth={2} />
      </button>
    </div>
  );
}
