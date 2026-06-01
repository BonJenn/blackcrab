import { describe, expect, it } from "vitest";
import {
  captureLayout,
  layoutLabel,
  parseLayouts,
  removeLayout,
  serializeLayouts,
  upsertLayout,
  type SavedLayout,
} from "./layouts";

const meta = { id: "id-1", createdAt: "2026-06-01T12:00:00.000Z" };

describe("layout helpers", () => {
  it("captures only known layout keys from a snapshot", () => {
    const layout = captureLayout(
      "  Frontend  ",
      "/Users/me/proj",
      {
        gridMode: "1",
        gridPanels: '["a","b"]',
        terminalHeight: "240", // not a layout key — ignored
        gridRowTopFraction: null, // absent — ignored
      },
      meta,
    );
    expect(layout.name).toBe("Frontend");
    expect(layout.project).toBe("/Users/me/proj");
    expect(layout.values).toEqual({ gridMode: "1", gridPanels: '["a","b"]' });
    expect(layout.values.terminalHeight).toBeUndefined();
  });

  it("upserts by name+project and appends otherwise", () => {
    const a: SavedLayout = { ...meta, name: "Work", project: "/p1", values: { gridMode: "1" } };
    const b: SavedLayout = { id: "id-2", createdAt: meta.createdAt, name: "Work", project: "/p2", values: {} };
    const aPrime: SavedLayout = { id: "id-3", createdAt: meta.createdAt, name: "Work", project: "/p1", values: { gridMode: "0" } };

    let list = upsertLayout([], a);
    list = upsertLayout(list, b);
    expect(list).toHaveLength(2);

    list = upsertLayout(list, aPrime);
    expect(list).toHaveLength(2);
    const work1 = list.find((l) => l.project === "/p1");
    expect(work1?.values.gridMode).toBe("0"); // replaced
  });

  it("removes by id", () => {
    const list: SavedLayout[] = [
      { ...meta, name: "A", project: "/p", values: {} },
      { id: "id-2", createdAt: meta.createdAt, name: "B", project: "/p", values: {} },
    ];
    expect(removeLayout(list, "id-1")).toHaveLength(1);
    expect(removeLayout(list, "id-1")[0].name).toBe("B");
  });

  it("round-trips through serialize/parse and tolerates junk", () => {
    const list: SavedLayout[] = [{ ...meta, name: "A", project: "/p", values: { gridMode: "1" } }];
    expect(parseLayouts(serializeLayouts(list))).toEqual(list);
    expect(parseLayouts(null)).toEqual([]);
    expect(parseLayouts("{not json")).toEqual([]);
    expect(parseLayouts('{"not":"array"}')).toEqual([]);
  });

  it("labels a layout with its project basename", () => {
    expect(
      layoutLabel({ ...meta, name: "Frontend", project: "/Users/me/proj", values: {} }),
    ).toBe("Frontend · proj");
    expect(
      layoutLabel({ ...meta, name: "Solo", project: "", values: {} }),
    ).toBe("Solo");
  });
});
