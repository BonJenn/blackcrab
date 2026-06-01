import { describe, expect, it } from "vitest";
import { commandMatchesQuery } from "./palette";

const del = {
  title: "Delete this conversation",
  hint: "danger",
  keywords: ["trash", "remove"],
};

describe("commandMatchesQuery", () => {
  it("matches everything on an empty/whitespace query", () => {
    expect(commandMatchesQuery(del, "")).toBe(true);
    expect(commandMatchesQuery(del, "   ")).toBe(true);
  });

  it("matches on the title (case-insensitive)", () => {
    expect(commandMatchesQuery(del, "DELETE")).toBe(true);
    expect(commandMatchesQuery(del, "conversation")).toBe(true);
  });

  it("matches on a keyword synonym not present in the title", () => {
    expect(commandMatchesQuery(del, "trash")).toBe(true);
    expect(commandMatchesQuery(del, "remove")).toBe(true);
  });

  it("matches on the hint", () => {
    expect(commandMatchesQuery(del, "danger")).toBe(true);
  });

  it("does not match unrelated queries", () => {
    expect(commandMatchesQuery(del, "backup")).toBe(false);
  });

  it("tolerates commands without keywords/hint", () => {
    expect(commandMatchesQuery({ title: "Open settings" }, "settings")).toBe(true);
    expect(commandMatchesQuery({ title: "Open settings" }, "trash")).toBe(false);
  });
});
