import { describe, expect, it } from "vitest";
import {
  findPanelForSession,
  formatPairingTimeLeft,
  normalizeModelValue,
  resolvePanelSession,
} from "./App";

describe("grid panel session helpers", () => {
  it("resolves direct session panels without consulting placeholder mappings", () => {
    expect(resolvePanelSession("session-1", {})).toBe("session-1");
  });

  it("resolves new panel placeholders after a session starts", () => {
    expect(resolvePanelSession("new:abc:123", { "new:abc:123": "session-2" })).toBe(
      "session-2",
    );
    expect(resolvePanelSession("new:abc:123", {})).toBeUndefined();
  });

  it("finds panels by direct and placeholder session ownership", () => {
    const panels = ["session-1", "new:abc:123"];
    const mappings = { "new:abc:123": "session-2" };

    expect(findPanelForSession("session-1", panels, mappings)).toBe("session-1");
    expect(findPanelForSession("session-2", panels, mappings)).toBe(
      "new:abc:123",
    );
    expect(findPanelForSession("missing", panels, mappings)).toBeUndefined();
  });
});

describe("model helpers", () => {
  it("normalizes empty model selections before backend calls", () => {
    expect(normalizeModelValue(undefined)).toBeNull();
    expect(normalizeModelValue(null)).toBeNull();
    expect(normalizeModelValue("")).toBeNull();
    expect(normalizeModelValue("  \t  ")).toBeNull();
    expect(normalizeModelValue(" sonnet ")).toBe("sonnet");
  });
});

describe("pairing helpers", () => {
  it("formats pairing code expiration countdowns", () => {
    expect(formatPairingTimeLeft(10_000, 9_500)).toBe("1s");
    expect(formatPairingTimeLeft(70_000, 10_000)).toBe("1m 00s");
    expect(formatPairingTimeLeft(75_000, 10_000)).toBe("1m 05s");
    expect(formatPairingTimeLeft(10_000, 10_000)).toBe("expired");
  });
});
