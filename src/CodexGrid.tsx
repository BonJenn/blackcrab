import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { type CodexGridSizes } from "./codexDesktop";

type Axis = "column" | 0 | 1;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function adjusted(sizes: CodexGridSizes, axis: Axis, value: number, snap: boolean): CodexGridSizes {
  if (axis === "column") return { ...sizes, column: clamp(snap && Math.abs(value - 50) < 3 ? 50 : value, 20, 80) };
  const rows: CodexGridSizes["rows"] = [...sizes.rows];
  const total = rows[axis] + rows[axis + 1];
  rows[axis] = Math.round(clamp(snap && Math.abs(value - total / 2) < 0.06 ? total / 2 : value, 0.2, total - 0.2) * 1e6) / 1e6;
  rows[axis + 1] = Math.round((total - rows[axis]) * 1e6) / 1e6;
  return { ...sizes, rows };
}

/** Visual sizing changes never replace pane elements or their session owners. */
export default function CodexGrid({ paneIds, layout, sizes, blocked, onResize, onEqualize, children }: {
  paneIds: string[]; layout: "single" | "grid"; sizes: CodexGridSizes; blocked: boolean;
  onResize: (sizes: CodexGridSizes) => boolean; onEqualize: () => boolean; children: ReactNode;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; axis: Axis; sizes: CodexGridSizes; identity: string; preview: CodexGridSizes } | null>(null);
  const [preview, setPreview] = useState<CodexGridSizes | null>(null);
  const identity = `${layout}:${JSON.stringify(paneIds)}`;
  const rowCount = Math.ceil(paneIds.length / 2);
  useEffect(() => { drag.current = null; setPreview(null); }, [identity, sizes, blocked]);
  const current = preview ?? sizes;
  const style: CSSProperties = layout === "grid" ? {
    gridTemplateColumns: paneIds.length > 1 ? `minmax(0, ${current.column}fr) 12px minmax(0, ${100 - current.column}fr)` : "minmax(0, 1fr)",
    gridTemplateRows: current.rows.slice(0, rowCount).map(row => `minmax(0, ${row}fr)`).join(" 12px "),
  } : {};
  function divider(axis: Axis) {
    const column = axis === "column";
    const percent = column ? current.column : current.rows[axis] / (current.rows[axis] + current.rows[axis + 1]) * 100;
    return <div key={String(axis)} role="separator" tabIndex={blocked ? -1 : 0} aria-disabled={blocked || undefined}
      aria-label={column ? "Resize conversation columns" : `Resize conversation rows ${axis + 1} and ${axis + 2}`}
      aria-orientation={column ? "vertical" : "horizontal"} aria-valuemin={column ? 20 : Math.round(20 / (current.rows[axis] + current.rows[axis + 1]))}
      aria-valuemax={column ? 80 : Math.round(100 - 20 / (current.rows[axis] + current.rows[axis + 1]))} aria-valuenow={Math.round(percent)}
      title="Drag to resize; hold Alt for free resizing. Use arrow keys, or double-click to equalize all panes."
      className={`codex-grid-divider codex-grid-divider-${column ? "column" : "row"}`}
      style={column ? { gridColumn: 2, gridRow: `1 / ${rowCount * 2}` } : { gridColumn: "1 / -1", gridRow: (axis + 1) * 2 }}
      onDoubleClick={() => { if (!blocked) onEqualize(); }}
      onKeyDown={event => {
        if (blocked) return;
        const previous = column ? "ArrowLeft" : "ArrowUp", next = column ? "ArrowRight" : "ArrowDown";
        if (![previous, next, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const total = column ? 100 : sizes.rows[axis] + sizes.rows[axis + 1];
        const minimum = column ? 20 : 0.2, maximum = column ? 80 : total - 0.2;
        const value = column ? sizes.column : sizes.rows[axis];
        onResize(adjusted(sizes, axis, event.key === "Home" ? minimum : event.key === "End" ? maximum : value + (event.key === previous ? -1 : 1) * (column ? 2 : 0.1), false));
      }}
      onPointerDown={event => {
        if (blocked || event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus();
        drag.current = { pointer: event.pointerId, axis, sizes, identity, preview: sizes };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const active = drag.current, bounds = grid.current?.getBoundingClientRect();
        if (!active || active.pointer !== event.pointerId || active.identity !== identity || !bounds || !bounds.width || !bounds.height) return;
        const total = active.sizes.rows.slice(0, rowCount).reduce((sum, value) => sum + value, 0);
        const value = column ? (event.clientX - bounds.left) / bounds.width * 100 : (event.clientY - bounds.top) / bounds.height * total - active.sizes.rows.slice(0, axis).reduce((sum, value) => sum + value, 0);
        active.preview = adjusted(active.sizes, axis, value, !event.altKey); setPreview(active.preview);
      }}
      onPointerUp={event => {
        const active = drag.current;
        if (!active || active.pointer !== event.pointerId) return;
        drag.current = null; setPreview(null);
        if (active.identity === identity && !blocked) onResize(active.preview);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; setPreview(null); }}
      onLostPointerCapture={() => { drag.current = null; setPreview(null); }} />;
  }
  return <div ref={grid} className={`codex-panes codex-panes-${layout}`} style={style}>
    {children}
    {layout === "grid" && paneIds.length > 1 && divider("column")}
    {layout === "grid" && Array.from({ length: Math.max(0, rowCount - 1) }, (_, index) => divider(index as 0 | 1))}
  </div>;
}
