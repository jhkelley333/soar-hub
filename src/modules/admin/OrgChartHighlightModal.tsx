import { useState } from "react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import type { OrgManager, OrgTreeResponse } from "./api";
import {
  exportOrgChartPosterPdf,
  type HighlightColor,
  type HighlightLegend,
  type HighlightMap,
} from "./orgChartPosterPdf";

const COLORS: { key: HighlightColor; hex: string; label: string }[] = [
  { key: "green",  hex: "#4CAF50", label: "Green" },
  { key: "orange", hex: "#FF9800", label: "Orange" },
  { key: "blue",   hex: "#2196F3", label: "Blue" },
  { key: "red",    hex: "#F44336", label: "Red" },
];

const EXEC_NODES = [
  { id: "nik",     name: "Nik Bhakta",      subtitle: "Principal" },
  { id: "ron",     name: "Ron Parikh",       subtitle: "Principal" },
  { id: "khaled",  name: "Khaled Habash",    subtitle: "COO" },
  { id: "jay",     name: "Jay Patel",        subtitle: "COS" },
  { id: "syed",    name: "Syed Zaidi",       subtitle: "VP of Accounting" },
  { id: "adam",    name: "Adam Scott",       subtitle: "VP of People Development" },
  { id: "crystal", name: "Crystal Boudreau", subtitle: "Director of Training & Development" },
  { id: "pinakin", name: "Pinakin Bhakta",   subtitle: "Compliance Manager" },
  { id: "cory",    name: "Cory Posey",       subtitle: "Director of Financial Analysis" },
  { id: "qsc",     name: "QSCulinary",       subtitle: "Full Back Office Solutions" },
];

function getLeader(managers: OrgManager[], role: string): string {
  const scoped = managers.filter((m) => String(m.role).toLowerCase() === role);
  const pool = scoped.length ? scoped : managers;
  const primary = pool.filter((m) => !m.acting);
  const chosen = (primary.length ? primary : pool).map((m) => m.full_name || m.email).filter(Boolean);
  return chosen[0] ?? "—";
}

function loadStored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}

function ColorPicker({
  id, highlights, onChange,
}: { id: string; highlights: HighlightMap; onChange: (id: string, c: HighlightColor | null) => void }) {
  const current = highlights[id] ?? null;
  return (
    <span className="flex items-center gap-1">
      {COLORS.map((c) => (
        <button
          key={c.key}
          title={c.label}
          onClick={() => onChange(id, current === c.key ? null : c.key)}
          style={{ background: c.hex }}
          className={`h-4 w-4 rounded-full border-2 transition-transform ${
            current === c.key ? "scale-125 border-zinc-900" : "border-transparent hover:scale-110"
          }`}
        />
      ))}
      {current && (
        <button
          title="Clear"
          onClick={() => onChange(id, null)}
          className="ml-0.5 text-[10px] text-zinc-400 hover:text-zinc-700"
        >✕</button>
      )}
    </span>
  );
}

export function OrgChartHighlightModal({
  open,
  onClose,
  tree,
}: {
  open: boolean;
  onClose: () => void;
  tree: OrgTreeResponse | null;
}) {
  const [highlights, setHighlights] = useState<HighlightMap>(() =>
    loadStored("org-chart-highlights", {}),
  );
  const [legend, setLegend] = useState<HighlightLegend>(() =>
    loadStored("org-chart-legend", { green: "", orange: "", blue: "", red: "" }),
  );

  function setHighlight(id: string, color: HighlightColor | null) {
    setHighlights((prev) => {
      const next = { ...prev };
      if (color === null) delete next[id]; else next[id] = color;
      localStorage.setItem("org-chart-highlights", JSON.stringify(next));
      return next;
    });
  }

  function setLegendLabel(color: HighlightColor, label: string) {
    setLegend((prev) => {
      const next = { ...prev, [color]: label };
      localStorage.setItem("org-chart-legend", JSON.stringify(next));
      return next;
    });
  }

  function clearAll() {
    setHighlights({});
    localStorage.setItem("org-chart-highlights", "{}");
  }

  function download() {
    exportOrgChartPosterPdf(tree, highlights, legend);
    onClose();
  }

  const regions = tree?.regions.filter((r) => r.is_active !== false && r.code !== "CORP") ?? [];
  const highlightCount = Object.keys(highlights).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Org Chart Poster"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {highlightCount > 0 && (
            <Button variant="ghost" onClick={clearAll}>Clear highlights</Button>
          )}
          <Button onClick={download} disabled={!tree || !regions.length}>
            Download PDF
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-xs text-zinc-500">
          Click a color to highlight a box in the PDF. Highlights and legend labels are saved in your browser.
        </p>

        {/* Exec block */}
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Executives</h3>
          <div className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
            {EXEC_NODES.map((e) => (
              <div key={e.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="flex-1 font-medium text-zinc-800">{e.name}</span>
                <span className="text-xs text-zinc-400">{e.subtitle}</span>
                <ColorPicker id={e.id} highlights={highlights} onChange={setHighlight} />
              </div>
            ))}
          </div>
        </section>

        {/* Org tree */}
        {regions.map((r) => (
          <section key={r.id}>
            <div className="mb-1 flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {getLeader(r.managers, "rvp")}
                {r.code ? <span className="ml-1 font-normal normal-case text-zinc-400">· {r.code}</span> : null}
              </h3>
              <ColorPicker id={r.id} highlights={highlights} onChange={setHighlight} />
            </div>
            <div className="space-y-2 pl-3">
              {r.areas.filter((a) => a.is_active !== false).map((a) => (
                <div key={a.id}>
                  <div className="flex items-center gap-2 pb-0.5">
                    <span className="font-medium text-zinc-700">
                      {getLeader(a.managers, "sdo")}
                      {a.code ? <span className="ml-1 font-normal text-zinc-400 text-xs">· {a.code}</span> : null}
                    </span>
                    <ColorPicker id={a.id} highlights={highlights} onChange={setHighlight} />
                  </div>
                  <div className="divide-y divide-zinc-100 rounded-md border border-zinc-200 pl-2">
                    {a.districts.filter((d) => d.is_active !== false).map((d) => (
                      <div key={d.id} className="flex items-center gap-2 px-2 py-1">
                        <span className="flex-1 text-zinc-700">
                          {getLeader(d.managers, "do")}
                          {d.code ? <span className="ml-1 text-zinc-400 text-xs">· {d.code}</span> : null}
                        </span>
                        <ColorPicker id={d.id} highlights={highlights} onChange={setHighlight} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {/* Legend */}
        <section className="border-t pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Legend (printed on PDF)
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {COLORS.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <span
                  className="h-4 w-4 flex-none rounded-full"
                  style={{ background: c.hex }}
                />
                <Input
                  value={legend[c.key]}
                  onChange={(e) => setLegendLabel(c.key, e.target.value)}
                  placeholder={`${c.label} = …`}
                  className="h-7 text-xs"
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-400">Leave blank to omit that color from the legend.</p>
        </section>
      </div>
    </Modal>
  );
}
