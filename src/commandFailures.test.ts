import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetCommandFailures,
  formatCommandFailure,
  getRecentCommandFailures,
  recordCommandFailure,
  subscribeCommandFailures,
} from "./commandFailures";

afterEach(() => __resetCommandFailures());

describe("command failures buffer", () => {
  it("records newest-last and caps the buffer at 25", () => {
    for (let i = 0; i < 30; i++) recordCommandFailure(`cmd-${i}`, "boom");
    const recent = getRecentCommandFailures();
    expect(recent).toHaveLength(25);
    // Oldest five dropped; newest retained.
    expect(recent[0].context).toBe("cmd-5");
    expect(recent[recent.length - 1].context).toBe("cmd-29");
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const cb = vi.fn();
    const unsub = subscribeCommandFailures(cb);
    recordCommandFailure("list_sessions failed", "timeout");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].at(-1).context).toBe("list_sessions failed");
    unsub();
    recordCommandFailure("again", "x");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("formats a failure as time + context + detail", () => {
    const line = formatCommandFailure({
      at: Date.UTC(2026, 5, 1, 13, 45, 9),
      context: "send_message",
      detail: "channel closed",
    });
    expect(line).toBe("13:45:09  send_message — channel closed");
  });
});
