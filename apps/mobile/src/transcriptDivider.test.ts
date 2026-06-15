import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@blackcrab/remote-protocol";

import { firstUnreadIndex, latestEntryId } from "./transcriptDivider";

function entry(id: string): TranscriptEntry {
  return {
    id,
    sessionId: "s1",
    kind: "assistant_message",
    createdAt: "2026-06-01T00:00:00Z",
    preview: id,
    truncated: false,
  };
}

const tail = [entry("m1"), entry("m2"), entry("m3"), entry("m4")];

describe("firstUnreadIndex", () => {
  it("points just after the last-read message", () => {
    expect(firstUnreadIndex(tail, "m2")).toBe(2);
  });

  it("returns -1 when the cursor is already at the newest entry", () => {
    expect(firstUnreadIndex(tail, "m4")).toBe(-1);
  });

  it("returns -1 when there is no cursor", () => {
    expect(firstUnreadIndex(tail, null)).toBe(-1);
    expect(firstUnreadIndex(tail, undefined)).toBe(-1);
  });

  it("returns -1 when the cursor is older than the loaded window", () => {
    expect(firstUnreadIndex(tail, "m0-not-in-window")).toBe(-1);
  });

  it("returns -1 for an empty transcript", () => {
    expect(firstUnreadIndex([], "m2")).toBe(-1);
  });
});

describe("latestEntryId", () => {
  it("returns the last entry's id", () => {
    expect(latestEntryId(tail)).toBe("m4");
  });

  it("returns null for an empty transcript", () => {
    expect(latestEntryId([])).toBeNull();
  });
});
