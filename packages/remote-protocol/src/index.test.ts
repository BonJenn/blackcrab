import { describe, expect, it } from "vitest";

import {
  isPairingCode,
  isRemoteAction,
  isRemoteEvent,
  REMOTE_PROTOCOL_VERSION,
} from "./index";

describe("remote-protocol", () => {
  it("exposes a stable protocol version", () => {
    expect(REMOTE_PROTOCOL_VERSION).toBe(1);
  });

  describe("isPairingCode", () => {
    it("accepts unambiguous 6-10 character codes", () => {
      expect(isPairingCode("ABCDEF")).toBe(true);
      expect(isPairingCode("QWERTY2345")).toBe(true);
    });

    it("rejects codes with ambiguous characters", () => {
      expect(isPairingCode("ABC0EF")).toBe(false);
      expect(isPairingCode("ABCDE1")).toBe(false);
      expect(isPairingCode("ABCDIE")).toBe(false);
      expect(isPairingCode("ABCOEF")).toBe(false);
    });

    it("rejects wrong length and wrong types", () => {
      expect(isPairingCode("ABCDE")).toBe(false);
      expect(isPairingCode("ABCDEFGHJKL")).toBe(false);
      expect(isPairingCode("")).toBe(false);
      expect(isPairingCode(undefined)).toBe(false);
      expect(isPairingCode(123456)).toBe(false);
    });
  });

  describe("isRemoteAction", () => {
    it("recognizes all action types", () => {
      expect(
        isRemoteAction({
          type: "send_message",
          hostId: "h",
          sessionId: "s",
          body: "hi",
        }),
      ).toBe(true);
      expect(
        isRemoteAction({ type: "stop_session", hostId: "h", sessionId: "s" }),
      ).toBe(true);
      expect(isRemoteAction({ type: "approve", hostId: "h", approvalId: "a" })).toBe(
        true,
      );
      expect(isRemoteAction({ type: "deny", hostId: "h", approvalId: "a" })).toBe(
        true,
      );
    });

    it("rejects unknown or malformed payloads", () => {
      expect(isRemoteAction({ type: "nope" })).toBe(false);
      expect(isRemoteAction(null)).toBe(false);
      expect(isRemoteAction("send_message")).toBe(false);
    });
  });

  describe("isRemoteEvent", () => {
    it("recognizes all event types", () => {
      const types = [
        "paired_hosts",
        "sessions",
        "transcript_tail",
        "approval_requested",
        "approval_resolved",
        "connection_status",
      ];
      for (const type of types) {
        expect(isRemoteEvent({ type })).toBe(true);
      }
    });

    it("rejects unknown or malformed payloads", () => {
      expect(isRemoteEvent({ type: "send_message" })).toBe(false);
      expect(isRemoteEvent(undefined)).toBe(false);
    });
  });
});
