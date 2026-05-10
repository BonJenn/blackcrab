import { describe, expect, it } from "vitest";
import { patchSessionInfoList, removeSessionInfoFromList } from "./sessionMetadata";

describe("session metadata helpers", () => {
  it("patches a matching session and preserves unrelated entries", () => {
    const first = { id: "one", title: "one" };
    const second = { id: "two", title: "two" };
    const sessions = [first, second];

    const next = patchSessionInfoList(sessions, "two", (session) => ({
      ...session,
      title: "updated",
    }));

    expect(next).not.toBe(sessions);
    expect(next[0]).toBe(first);
    expect(next[1]).toEqual({ id: "two", title: "updated" });
  });

  it("returns the original array when patch target is missing", () => {
    const sessions = [{ id: "one", title: "one" }];

    expect(patchSessionInfoList(sessions, "missing", (session) => session)).toBe(
      sessions,
    );
  });

  it("removes a matching session and preserves the original array on misses", () => {
    const sessions = [{ id: "one" }, { id: "two" }];

    expect(removeSessionInfoFromList(sessions, "one")).toEqual([{ id: "two" }]);
    expect(removeSessionInfoFromList(sessions, "missing")).toBe(sessions);
  });
});
