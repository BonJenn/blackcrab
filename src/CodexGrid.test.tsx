import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CodexGrid from "./CodexGrid";
import { validCodexGridSizes, type CodexGridSizes } from "./codexDesktop";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: Root;
beforeEach(() => { element = document.createElement("div"); document.body.append(element); root = createRoot(element); });
afterEach(() => { act(() => root.unmount()); element.remove(); });
function fixture() {
  const resize = vi.fn(), equalize = vi.fn();
  function Grid({ panes = ["one", "two", "three", "four"], layout = "grid", blocked = false }: { panes?: string[]; layout?: "single" | "grid"; blocked?: boolean }) {
    const [sizes, setSizes] = useState<CodexGridSizes>({ column: 50, rows: [1, 1, 1] });
    return <CodexGrid paneIds={panes} layout={layout} sizes={sizes} blocked={blocked} onResize={next => { resize(next); setSizes(next); return true; }} onEqualize={() => { equalize(); setSizes({ column: 50, rows: [1, 1, 1] }); return true; }}><section>stable pane</section></CodexGrid>;
  }
  const render = (props: Parameters<typeof Grid>[0] = {}) => act(() => root.render(<Grid {...props} />));
  return { render, resize, equalize };
}
const separator = (text: string) => element.querySelector<HTMLDivElement>(`[role="separator"][aria-label="${text}"]`)!;
function pointer(target: Element, type: string, x: number, y: number, extra: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, ...extra });
  Object.defineProperty(event, "pointerId", { value: 1 });
  act(() => target.dispatchEvent(event));
}
function prepare() {
  const grid = element.querySelector<HTMLDivElement>(".codex-panes")!;
  vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
  for (const node of element.querySelectorAll<HTMLElement>('[role="separator"]')) { node.setPointerCapture = vi.fn(); node.releasePointerCapture = vi.fn(); }
  return grid;
}
function key(target: Element, value: string) { act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }))); }
it("previews pointer sizing, snaps equal columns unless Alt is held, and commits only on release", () => {
  const f = fixture(); f.render(); const grid = prepare(), column = separator("Resize conversation columns"), pane = grid.firstElementChild;
  pointer(column, "pointerdown", 500, 0); pointer(column, "pointermove", 515, 0);
  expect(column.getAttribute("aria-valuenow")).toBe("50"); expect(f.resize).not.toHaveBeenCalled();
  pointer(column, "pointermove", 515, 0, { altKey: true }); expect(grid.style.gridTemplateColumns).toContain("51.5fr");
  pointer(column, "pointerup", 515, 0); expect(f.resize).toHaveBeenLastCalledWith({ column: 51.5, rows: [1, 1, 1] });
  expect(grid.firstElementChild).toBe(pane);
});
it("supports bounded keyboard row and column sizing and double-click equalization", () => {
  const f = fixture(); f.render(); const column = separator("Resize conversation columns"), row = separator("Resize conversation rows 1 and 2");
  key(column, "ArrowRight"); expect(f.resize.mock.lastCall![0].column).toBe(52);
  key(column, "Home"); expect(f.resize.mock.lastCall![0].column).toBe(20);
  key(column, "End"); expect(f.resize.mock.lastCall![0].column).toBe(80);
  key(row, "ArrowDown"); expect(f.resize.mock.lastCall![0].rows[0]).toBeCloseTo(1.1); expect(f.resize.mock.lastCall![0].rows[1]).toBeCloseTo(0.9); expect(f.resize.mock.lastCall![0].rows[2]).toBe(1);
  key(row, "End"); expect(f.resize.mock.lastCall![0].rows).toEqual([1.8, 0.2, 1]);
  expect(validCodexGridSizes(f.resize.mock.lastCall![0])).toBe(true);
  key(row, "Home"); expect(f.resize.mock.lastCall![0].rows).toEqual([0.2, 1.8, 1]);
  expect(validCodexGridSizes(f.resize.mock.lastCall![0])).toBe(true);
  expect(row.getAttribute("aria-orientation")).toBe("horizontal");
  act(() => row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(f.equalize).toHaveBeenCalledOnce(); expect(column.getAttribute("aria-valuenow")).toBe("50"); expect(row.getAttribute("aria-valuenow")).toBe("50");
});
it("cancels an interrupted pointer drag and retires it when the pane layout changes", () => {
  const f = fixture(); f.render(); const grid = prepare(), column = separator("Resize conversation columns");
  pointer(column, "pointerdown", 500, 0); pointer(column, "pointermove", 700, 0); expect(grid.style.gridTemplateColumns).toContain("70fr");
  pointer(column, "pointercancel", 700, 0); expect(grid.style.gridTemplateColumns).toContain("50fr"); expect(f.resize).not.toHaveBeenCalled();
  pointer(column, "pointerdown", 500, 0); pointer(column, "pointermove", 700, 0); f.render({ panes: ["one", "two"] }); pointer(column, "pointerup", 700, 0);
  expect(f.resize).not.toHaveBeenCalled(); expect(element.querySelectorAll('[role="separator"]')).toHaveLength(1);
});
it("resizes adjacent rows without changing other row weights and blocks unavailable controls", () => {
  const f = fixture(); f.render({ panes: ["one", "two", "three", "four", "five", "six"] }); prepare();
  const row = separator("Resize conversation rows 2 and 3"); pointer(row, "pointerdown", 0, 667); pointer(row, "pointermove", 0, 750); pointer(row, "pointerup", 0, 750);
  expect(f.resize.mock.lastCall![0].rows).toEqual([1, 1.25, 0.75]);
  f.resize.mockClear(); f.render({ blocked: true }); const column = separator("Resize conversation columns");
  expect(column.tabIndex).toBe(-1); key(column, "ArrowRight"); pointer(column, "pointerdown", 500, 0); pointer(column, "pointermove", 700, 0); pointer(column, "pointerup", 700, 0);
  expect(f.resize).not.toHaveBeenCalled();
  f.render({ layout: "single" }); expect(element.querySelector('[role="separator"]')).toBeNull();
});
