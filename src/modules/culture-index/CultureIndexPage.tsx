import { useMemo, useState } from "react";
import { Search, Info } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Drawer } from "@/shared/ui/Drawer";
import { PatternDetail, FAMILY_CHIP } from "./PatternDetail";
import {
  CONSTRUCTS,
  FAMILIES,
  PATTERNS,
  familyOf,
  type CiPattern,
  type FamilyId,
} from "./patterns";

export function CultureIndexPage() {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState<FamilyId | "all">("all");
  const [active, setActive] = useState<CiPattern | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return PATTERNS.filter((p) => {
      if (family !== "all" && p.family !== family) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.essence.toLowerCase().includes(needle) ||
        p.strengths.some((s) => s.toLowerCase().includes(needle)) ||
        p.watchouts.some((w) => w.toLowerCase().includes(needle))
      );
    });
  }, [q, family]);

  return (
    <>
      <PageHeader
        title="Culture Index"
        description="The trait framework and all 21 patterns — the reference behind every trait on the roster and in accounts."
      />

      {/* Primer: the seven constructs */}
      <Card className="mb-6">
        <CardHeader
          title="How to read it"
          description="Six trait letters plus an energy index. A/B/C/D are read against the person's norm line; L/I are absolute 0–10."
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CONSTRUCTS.map((c) => (
              <div key={c.code} className="rounded-lg border border-border bg-surface-muted/40 p-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-bold text-accent">{c.code}</span>
                  <span className="text-sm font-semibold text-heading">{c.name}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-400">
                    {c.kind}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">{c.measures}</p>
                {c.lowLabel && c.highLabel && (
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                    <span>{c.lowLabel}</span>
                    <span className="text-right">{c.highLabel}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-accent/5 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
            <span>
              <span className="font-semibold text-heading">Defaults, not ceiling.</span>{" "}
              Traits describe natural wiring, not ability or potential. Self-aware people routinely
              outperform their "natural fit" by building compensating structure. Treat these as
              coaching context — never a verdict on capability. Internal reference only; not an
              official Culture Index product.
            </span>
          </div>
        </CardBody>
      </Card>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" strokeWidth={2} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search patterns…"
            className="block w-full rounded-md border-0 bg-surface py-2 pl-9 pr-3 text-sm text-heading ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FamilyChip label="All" active={family === "all"} onClick={() => setFamily("all")} hue="zinc" />
          {FAMILIES.map((f) => (
            <FamilyChip
              key={f.id}
              label={f.name}
              active={family === f.id}
              onClick={() => setFamily(f.id)}
              hue={f.hue}
            />
          ))}
        </div>
      </div>

      {/* Pattern grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => {
          const fam = familyOf(p.family);
          const chip = fam ? FAMILY_CHIP[fam.hue] : FAMILY_CHIP.zinc;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setActive(p)}
              className="group flex flex-col rounded-xl border border-border bg-surface p-4 text-left shadow-card transition hover:border-accent/50 hover:shadow-float focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold tracking-tight text-heading">{p.name}</span>
                {p.isFlag && (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">flag</span>
                )}
              </div>
              <span className={`mt-1 w-fit rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${chip}`}>
                {fam?.name}
              </span>
              <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink-muted">{p.essence}</p>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-zinc-400">
            No patterns match "{q}".
          </p>
        )}
      </div>

      <Drawer open={!!active} onClose={() => setActive(null)} title="Culture Index profile">
        {active && <PatternDetail pattern={active} />}
      </Drawer>
    </>
  );
}

function FamilyChip({
  label,
  active,
  onClick,
  hue,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hue: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
        active
          ? FAMILY_CHIP[hue] ?? FAMILY_CHIP.zinc
          : "bg-surface text-ink-muted ring-border hover:ring-accent/40"
      }`}
    >
      {label}
    </button>
  );
}
