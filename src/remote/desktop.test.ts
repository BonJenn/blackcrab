import { describe, expect, it } from "vitest";
import { isRemoteEvent } from "@blackcrab/remote-protocol";

import {
  fetchDesktopHostInfo,
  getRemoteSnapshot,
  normalizeHostInfo,
} from "./desktop";

describe("normalizeHostInfo", () => {
  it("passes through a well-formed payload", () => {
    const host = normalizeHostInfo({
      hostId: "desktop-studio",
      displayName: "studio",
      platform: "macos",
      appVersion: "0.2.0",
      online: true,
      lastSeenAtMs: 1_700_000_000_000,
    });
    expect(host).toEqual({
      hostId: "desktop-studio",
      displayName: "studio",
      platform: "macos",
      appVersion: "0.2.0",
      online: true,
      lastSeenAtMs: 1_700_000_000_000,
    });
  });

  it("coerces unknown platforms to 'unknown' and falls back on missing fields", () => {
    const host = normalizeHostInfo({
      displayName: "weirdbox",
      platform: "plan9",
      lastSeenAtMs: "not a number",
    });
    expect(host.platform).toBe("unknown");
    expect(host.hostId).toBe("desktop-weirdbox");
    expect(host.appVersion).toBe("0.0.0");
    expect(host.online).toBe(true);
    expect(typeof host.lastSeenAtMs).toBe("number");
  });

  it("handles a null / empty payload safely", () => {
    const host = normalizeHostInfo(null);
    expect(host.displayName).toBe("blackcrab-host");
    expect(host.platform).toBe("unknown");
  });
});

describe("fetchDesktopHostInfo", () => {
  it("calls the supplied invoker and normalizes", async () => {
    const host = await fetchDesktopHostInfo(async () => ({
      hostId: "desktop-x",
      displayName: "x",
      platform: "linux",
      appVersion: "0.2.0",
      online: true,
      lastSeenAtMs: 1,
    }));
    expect(host.platform).toBe("linux");
    expect(host.hostId).toBe("desktop-x");
  });
});

describe("getRemoteSnapshot", () => {
  it("produces a valid RemoteEvent[] using the injected invoker", async () => {
    const events = await getRemoteSnapshot(
      {
        sessions: [
          {
            info: {
              id: "sess-1",
              title: "T",
              cwd: "/tmp/p",
              model: "claude-opus-4-7",
              mtime_ms: Date.UTC(2026, 4, 17, 12, 0, 0),
              interrupted: false,
              last_result_is_error: false,
            },
            activity: { state: "running", unread: false },
          },
        ],
        approvals: [
          {
            id: "appr-1",
            sessionId: "sess-1",
            kind: "shell_command",
            summary: "run",
            requestedAtMs: Date.UTC(2026, 4, 17, 12, 0, 0),
          },
        ],
      },
      {
        invoker: async () => ({
          hostId: "desktop-studio",
          displayName: "studio",
          platform: "macos",
          appVersion: "0.2.0",
          online: true,
          lastSeenAtMs: Date.UTC(2026, 4, 17, 12, 0, 0),
        }),
      },
    );

    expect(events).toHaveLength(2);
    expect(events.every(isRemoteEvent)).toBe(true);
    const sessionsEvent = events[1];
    if (sessionsEvent.type === "sessions") {
      expect(sessionsEvent.hostId).toBe("desktop-studio");
      expect(sessionsEvent.sessions[0]?.state).toBe("awaiting_approval");
      expect(sessionsEvent.sessions[0]?.pendingApprovalCount).toBe(1);
    }
  });
});
