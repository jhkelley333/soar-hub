// Org-tree visibility filter for the Schedule — region → area → district →
// store. Each row carries a collapse chevron, a color swatch, a node-type
// glyph, the name, a "YOU" badge on the viewer's own scope node, and an eye
// toggle that shows/hides that branch. Visibility operates on a Set of active
// store NUMBERS (events carry store_number); the parent owns the set.
import { useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Columns3, Eye, EyeOff, Map, Shield } from "lucide-react";
import { cn } from "@/lib/cn";
import type { RegionGroup, YouMarker } from "./types";

type Kind = "region" | "area" | "district" | "store";

interface TreeNode {
  key: string;
  kind: Kind;
  name: string;
  scopeId: string | null; // for YOU matching
  storeNumbers: string[]; // every descendant store number (leaf: its own)
  children: TreeNode[];
}

// A small fixed palette; each node gets a stable swatch from a hash of its key.
const SWATCHES = [
  "bg-sky-500", "bg-violet-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-teal-500", "bg-indigo-500", "bg-pink-500",
  "bg-cyan-500", "bg-lime-500",
];
function swatchFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

const GLYPH: Record<Kind, typeof Map> = {
  region: Map,
  area: Shield,
  district: Columns3,
  store: Building2,
};

function buildTree(tree: RegionGroup[]): TreeNode[] {
  return tree.map((r) => {
    const areas: TreeNode[] = r.areas.map((a) => {
      const districts: TreeNode[] = a.districts.map((d) => {
        const stores: TreeNode[] = d.stores.map((s) => ({
          key: `store:${s.id}`,
          kind: "store" as const,
          name: `#${s.number}${s.name ? ` ${s.name}` : ""}`,
          scopeId: s.id,
          storeNumbers: [s.number],
          children: [],
        }));
        return {
          key: `district:${d.district_id ?? "none"}`,
          kind: "district" as const,
          name: `${d.district_name || "Stores"}${d.district_code ? ` · ${d.district_code}` : ""}`,
          scopeId: d.district_id,
          storeNumbers: stores.flatMap((s) => s.storeNumbers),
          children: stores,
        };
      });
      return {
        key: `area:${a.area_id ?? "none"}`,
        kind: "area" as const,
        name: a.area_name || "Area",
        scopeId: a.area_id,
        storeNumbers: districts.flatMap((d) => d.storeNumbers),
        children: districts,
      };
    });
    return {
      key: `region:${r.region_id ?? "none"}`,
      kind: "region" as const,
      name: r.region_name || "Region",
      scopeId: r.region_id,
      storeNumbers: areas.flatMap((a) => a.storeNumbers),
      children: areas,
    };
  });
}

export function OrgTreeFilter({
  tree,
  active,
  onChange,
  you,
}: {
  tree: RegionGroup[];
  active: Set<string>;
  onChange: (next: Set<string>) => void;
  you?: YouMarker;
}) {
  const nodes = useMemo(() => buildTree(tree), [tree]);
  const allNums = useMemo(() => nodes.flatMap((n) => n.storeNumbers), [nodes]);
  const allOn = allNums.length > 0 && allNums.every((n) => active.has(n));

  // Collapsed branch keys. Default: everything expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function setMany(nums: string[], on: boolean) {
    const next = new Set(active);
    for (const n of nums) on ? next.add(n) : next.delete(n);
    onChange(next);
  }
  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (nodes.length === 0) return null;

  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Organization</span>
        <button onClick={() => setMany(allNums, !allOn)} className="text-xs font-medium text-accent hover:underline">
          {allOn ? "Hide all" : "Show all"}
        </button>
      </div>
      <div className="space-y-0.5">
        {nodes.map((n) => (
          <Row
            key={n.key}
            node={n}
            depth={0}
            active={active}
            collapsed={collapsed}
            you={you}
            onToggleVisible={setMany}
            onToggleCollapse={toggleCollapse}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  node,
  depth,
  active,
  collapsed,
  you,
  onToggleVisible,
  onToggleCollapse,
}: {
  node: TreeNode;
  depth: number;
  active: Set<string>;
  collapsed: Set<string>;
  you?: YouMarker;
  onToggleVisible: (nums: string[], on: boolean) => void;
  onToggleCollapse: (key: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = !collapsed.has(node.key);
  const allOn = node.storeNumbers.length > 0 && node.storeNumbers.every((n) => active.has(n));
  const someOn = node.storeNumbers.some((n) => active.has(n));
  const visible = allOn || someOn;
  const Glyph = GLYPH[node.kind];
  const isYou =
    !!you && you.scope_type === node.kind && you.scope_id != null && you.scope_id === node.scopeId;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded-md py-1 pr-1 hover:bg-zinc-100",
          !visible && "opacity-50"
        )}
        style={{ paddingLeft: depth * 14 + 2 }}
      >
        {/* Collapse chevron (or spacer for leaves) */}
        {hasChildren ? (
          <button
            onClick={() => onToggleCollapse(node.key)}
            className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-zinc-600"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}

        {/* Color swatch */}
        <span className={cn("h-3 w-3 shrink-0 rounded-[3px]", swatchFor(node.key))} />

        {/* Node-type glyph */}
        <Glyph className="h-3.5 w-3.5 shrink-0 text-zinc-400" />

        {/* Name (+ YOU badge) */}
        <button
          onClick={() => onToggleVisible(node.storeNumbers, !allOn)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={allOn ? "Hide" : "Show"}
        >
          <span
            className={cn(
              "truncate",
              node.kind === "store" ? "text-zinc-600" : "font-medium text-midnight"
            )}
          >
            {node.name}
          </span>
          {isYou && (
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-accent">
              You
            </span>
          )}
        </button>

        {/* Eye toggle */}
        <button
          onClick={() => onToggleVisible(node.storeNumbers, !allOn)}
          className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:text-zinc-700"
          aria-label={visible ? "Hide" : "Show"}
        >
          {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
      </div>

      {hasChildren && isOpen && (
        <div>
          {node.children.map((c) => (
            <Row
              key={c.key}
              node={c}
              depth={depth + 1}
              active={active}
              collapsed={collapsed}
              you={you}
              onToggleVisible={onToggleVisible}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </div>
      )}
    </div>
  );
}
