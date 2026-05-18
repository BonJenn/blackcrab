import { describe, expect, it } from "vitest";
import { isRemoteEvent } from "@blackcrab/remote-protocol";

import {
  buildSnapshotEvents,
  toApprovalRequest,
  toPairedHostSummary,
  toSessionState,
  toSessionSummary,
  type DesktopHostInfo,
  type DesktopSessionActivity,
  type DesktopSessionInfo,
} from "./snapshot";

const HOST: DesktopHostInfo = {
  hostId: "host-1",
  displayName: "Studio Mac",
  platform: "macos",
  appVersion: "0.2.0",
  online: true,
  lastSeenAtMs: Date.UTC(2026, 4, 17, 12, 0, 0),
};

function makeInfo(overrides: Partial<DesktopSessionInfo> = {}): DesktopSessionInfo {
  return {
    id: "sess-1",
    title: "Test session",
    cwd: "/tmp/project",
    model: "claude-opus-4-7",
    mtime_ms: Date.UTC(2026, 4, 17, 11, 30, 0),
    interrupted: false,
    last_result_is_error: false,
    ...overrides,
  };
}

function makeActivity(
  overrides: Partial<DesktopSessionActivity> = {},
): DesktopSessionActivity {
  return { state: "idle", unread: false, ...overrides };
}

describe("toPairedHostSummary", () => {
  it("formats the timestamp as ISO-8601", () => {
    const summary = toPairedHostSummary(HOST);
    expect(summary.hostId).toBe("host-1");
    expect(summary.lastSeenAt).toBe("2026-05-17T12:00:00.000Z");
    expect(summary.online).toBe(true);
  });
});

describe("toSessionState", () => {
  it("returns errored when the last result errored", () => {
    expect(
      toSessionState({ interrupted: false, last_result_is_error: true }, undefined, 0),
    ).toBe("errored");
  });

  it("returns errored when activity state is error", () => {
    expect(
      toSessionState(
        { interrupted: false, last_result_is_error: false },
        makeActivity({ state: "error" }),
        0,
      ),
    ).toBe("errored");
  });

  it("prefers awaiting_approval when any approval is pending", () => {
    expect(
      toSessionState(
        { interrupted: false, last_result_is_error: false },
        makeActivity({ state: "running" }),
        1,
      ),
    ).toBe("awaiting_approval");
  });

  it("treats interrupted as idle", () => {
    expect(
      toSessionState(
        { interrupted: true, last_result_is_error: false },
        makeActivity({ state: "running" }),
        0,
      ),
    ).toBe("idle");
  });

  it("maps activity states onto protocol states", () => {
    const base = { interrupted: false, last_result_is_error: false };
    expect(toSessionState(base, makeActivity({ state: "running" }), 0)).toBe(
      "running",
    );
    expect(toSessionState(base, makeActivity({ state: "waiting" }), 0)).toBe(
      "awaiting_input",
    );
    expect(toSessionState(base, makeActivity({ state: "done" }), 0)).toBe(
      "completed",
    );
    expect(toSessionState(base, makeActivity({ state: "unread" }), 0)).toBe(
      "completed",
    );
    expect(toSessionState(base, makeActivity({ state: "interrupted" }), 0)).toBe(
      "idle",
    );
    expect(toSessionState(base, undefined, 0)).toBe("idle");
  });
});

describe("toSessionSummary", () => {
  it("projects all relevant fields and counts", () => {
    const summary = toSessionSummary({
      hostId: HOST.hostId,
      info: makeInfo(),
      activity: makeActivity({ state: "running", unread: true }),
      pendingApprovalCount: 2,
    });
    expect(summary).toEqual({
      hostId: "host-1",
      sessionId: "sess-1",
      title: "Test session",
      projectPath: "/tmp/project",
      model: "claude-opus-4-7",
      state: "awaiting_approval",
      updatedAt: "2026-05-17T11:30:00.000Z",
      pendingApprovalCount: 2,
      unreadCount: 1,
    });
  });

  it("defaults pending and unread counts when not provided", () => {
    const summary = toSessionSummary({
      hostId: HOST.hostId,
      info: makeInfo(),
    });
    expect(summary.pendingApprovalCount).toBe(0);
    expect(summary.unreadCount).toBe(0);
    expect(summary.state).toBe("idle");
  });
});

describe("toApprovalRequest", () => {
  it("serializes timestamps and preserves optional expiry", () => {
    const approval = toApprovalRequest("host-1", {
      id: "appr-1",
      sessionId: "sess-1",
      kind: "shell_command",
      summary: "Run npm test",
      requestedAtMs: Date.UTC(2026, 4, 17, 12, 0, 0),
      expiresAtMs: Date.UTC(2026, 4, 17, 12, 5, 0),
    });
    expect(approval.requestedAt).toBe("2026-05-17T12:00:00.000Z");
    expect(approval.expiresAt).toBe("2026-05-17T12:05:00.000Z");
    expect(approval.hostId).toBe("host-1");
  });

  it("omits expiresAt when not provided", () => {
    const approval = toApprovalRequest("host-1", {
      id: "appr-2",
      sessionId: "sess-1",
      kind: "tool_call",
      summary: "Edit file",
      requestedAtMs: Date.UTC(2026, 4, 17, 12, 0, 0),
    });
    expect(approval.expiresAt).toBeUndefined();
  });
});

describe("buildSnapshotEvents", () => {
  it("emits a paired_hosts event and a sessions event with approval counts folded in", () => {
    const events = buildSnapshotEvents({
      host: HOST,
      sessions: [
        {
          info: makeInfo({ id: "sess-1" }),
          activity: makeActivity({ state: "running" }),
        },
        {
          info: makeInfo({ id: "sess-2", title: "Other" }),
          activity: makeActivity({ state: "done" }),
        },
      ],
      approvals: [
        {
          id: "appr-1",
          sessionId: "sess-1",
          kind: "shell_command",
          summary: "Run command",
          requestedAtMs: Date.UTC(2026, 4, 17, 12, 0, 0),
        },
        {
          id: "appr-2",
          sessionId: "sess-1",
          kind: "tool_call",
          summary: "Edit file",
          requestedAtMs: Date.UTC(2026, 4, 17, 12, 1, 0),
        },
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.every(isRemoteEvent)).toBe(true);

    const [hosts, sessions] = events;
    expect(hosts.type).toBe("paired_hosts");
    if (hosts.type === "paired_hosts") {
      expect(hosts.hosts).toHaveLength(1);
      expect(hosts.hosts[0].hostId).toBe("host-1");
    }

    expect(sessions.type).toBe("sessions");
    if (sessions.type === "sessions") {
      expect(sessions.hostId).toBe("host-1");
      const sess1 = sessions.sessions.find((s) => s.sessionId === "sess-1");
      const sess2 = sessions.sessions.find((s) => s.sessionId === "sess-2");
      expect(sess1?.pendingApprovalCount).toBe(2);
      expect(sess1?.state).toBe("awaiting_approval");
      expect(sess2?.pendingApprovalCount).toBe(0);
      expect(sess2?.state).toBe("completed");
    }
  });

  it("works with zero sessions and zero approvals", () => {
    const events = buildSnapshotEvents({ host: HOST, sessions: [] });
    expect(events).toHaveLength(2);
    const sessionsEvent = events[1];
    if (sessionsEvent.type === "sessions") {
      expect(sessionsEvent.sessions).toHaveLength(0);
    }
  });
});
