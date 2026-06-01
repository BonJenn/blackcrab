import { describe, expect, it } from "vitest";
import { entriesSignature, sessionStatusLabel } from "./sessionStatus";

describe("sessionStatusLabel", () => {
  it("prioritizes running, then read-only, then connected, then idle", () => {
    expect(sessionStatusLabel({ busy: true, sessionOn: true, readOnly: true })).toBe("running");
    expect(sessionStatusLabel({ busy: false, sessionOn: false, readOnly: true })).toBe("read-only");
    expect(sessionStatusLabel({ busy: false, sessionOn: true, readOnly: false })).toBe("connected");
    expect(sessionStatusLabel({ busy: false, sessionOn: false, readOnly: false })).toBe("idle");
  });

  it("read-only beats connected but not running", () => {
    // A read-only observer never owns a subprocess, so sessionOn is false in
    // practice; but if both were set, running wins and read-only beats connected.
    expect(sessionStatusLabel({ busy: false, sessionOn: true, readOnly: true })).toBe("read-only");
  });
});

describe("entriesSignature", () => {
  it("is stable for identical tails and changes when an entry is appended", () => {
    const a = [{ id: "1", kind: "user", text: "hi" }];
    const b = [
      { id: "1", kind: "user", text: "hi" },
      { id: "2", kind: "assistant", blocks: [] },
    ];
    expect(entriesSignature(a)).toBe(entriesSignature(a));
    expect(entriesSignature(a)).not.toBe(entriesSignature(b));
  });

  it("changes when the last entry grows but keeps its id (streaming)", () => {
    const small = [{ id: "9", kind: "assistant", blocks: [{ t: "x" }] }];
    const grown = [{ id: "9", kind: "assistant", blocks: [{ t: "x" }, { t: "yz" }] }];
    expect(entriesSignature(small)).not.toBe(entriesSignature(grown));
  });

  it("handles an empty tail", () => {
    expect(entriesSignature([])).toBe("0");
  });
});
