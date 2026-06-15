import { describe, expect, it } from "vitest";

import {
  createDesktopPairingPayload,
  DESKTOP_PAIRING_PAYLOAD_TYPE,
  hasDesktopPairingPayloadExpired,
  isDesktopPairingPayload,
  isHeartbeat,
  isHostPlatform,
  isPairingCode,
  isRemoteAction,
  isRemoteEnvelope,
  isRemoteEvent,
  isRemoteWireMessage,
  parseDesktopPairingPayload,
  parseEnvelope,
  REMOTE_PROTOCOL_VERSION,
  serializeDesktopPairingPayload,
  serializeEnvelope,
  wrapEnvelope,
  type RemoteEnvelope,
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

  describe("isHostPlatform", () => {
    it("recognizes supported desktop platforms", () => {
      expect(isHostPlatform("macos")).toBe(true);
      expect(isHostPlatform("windows")).toBe(true);
      expect(isHostPlatform("linux")).toBe(true);
      expect(isHostPlatform("unknown")).toBe(true);
    });

    it("rejects unsupported values", () => {
      expect(isHostPlatform("ios")).toBe(false);
      expect(isHostPlatform("android")).toBe(false);
      expect(isHostPlatform(undefined)).toBe(false);
    });
  });

  describe("desktop pairing payloads", () => {
    const payload = createDesktopPairingPayload({
      hostId: "host-local-mac",
      displayName: "Studio MacBook Pro",
      platform: "macos",
      appVersion: "0.2.0",
      code: "ABCDEF",
      expiresAtMs: 1_800_000_000_000,
      lanHost: "192.168.1.5",
      lanPort: 8124,
    });

    it("creates and validates a desktop pairing payload", () => {
      expect(payload).toEqual({
        type: DESKTOP_PAIRING_PAYLOAD_TYPE,
        protocolVersion: REMOTE_PROTOCOL_VERSION,
        hostId: "host-local-mac",
        displayName: "Studio MacBook Pro",
        platform: "macos",
        appVersion: "0.2.0",
        code: "ABCDEF",
        expiresAtMs: 1_800_000_000_000,
        lanHost: "192.168.1.5",
        lanPort: 8124,
      });
      expect(isDesktopPairingPayload(payload)).toBe(true);
    });

    it("serializes and parses valid payloads", () => {
      expect(parseDesktopPairingPayload(serializeDesktopPairingPayload(payload))).toEqual(
        payload,
      );
    });

    it("returns null for invalid JSON or unsupported payloads", () => {
      expect(parseDesktopPairingPayload("not json")).toBeNull();
      expect(
        parseDesktopPairingPayload(
          JSON.stringify({ ...payload, protocolVersion: 999 }),
        ),
      ).toBeNull();
      expect(
        parseDesktopPairingPayload(JSON.stringify({ ...payload, code: "ABC0EF" })),
      ).toBeNull();
      expect(
        parseDesktopPairingPayload(JSON.stringify({ ...payload, platform: "ios" })),
      ).toBeNull();
      expect(
        parseDesktopPairingPayload(
          JSON.stringify({ ...payload, expiresAtMs: Number.NaN }),
        ),
      ).toBeNull();
      expect(
        parseDesktopPairingPayload(JSON.stringify({ ...payload, lanHost: "" })),
      ).toBeNull();
      expect(
        parseDesktopPairingPayload(JSON.stringify({ ...payload, lanPort: 0 })),
      ).toBeNull();
      expect(
        parseDesktopPairingPayload(JSON.stringify({ ...payload, lanPort: 65536 })),
      ).toBeNull();
    });

    it("throws when asked to serialize an invalid payload", () => {
      expect(() =>
        serializeDesktopPairingPayload({ ...payload, code: "ABC0EF" }),
      ).toThrow("Invalid desktop pairing payload.");
    });

    it("checks expiration against a supplied clock", () => {
      expect(hasDesktopPairingPayloadExpired(payload, payload.expiresAtMs - 1)).toBe(
        false,
      );
      expect(hasDesktopPairingPayloadExpired(payload, payload.expiresAtMs)).toBe(
        true,
      );
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
      expect(
        isRemoteAction({ type: "focus_session", hostId: "h", sessionId: "s" }),
      ).toBe(true);
      expect(
        isRemoteAction({
          type: "set_read_cursor",
          hostId: "h",
          sessionId: "s",
          lastReadMessageId: "msg-3",
          readAtMs: 1_700_000_000_000,
        }),
      ).toBe(true);
      expect(
        isRemoteAction({
          type: "start_session",
          hostId: "h",
          cwd: "/work/proj",
          body: "hello",
        }),
      ).toBe(true);
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
        "read_cursor",
        "project_dirs",
        "session_started",
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

  describe("heartbeat", () => {
    it("recognizes ping and pong with matching seq", () => {
      expect(isHeartbeat({ type: "ping", seq: 0 })).toBe(true);
      expect(isHeartbeat({ type: "pong", seq: 17 })).toBe(true);
    });

    it("rejects malformed heartbeats", () => {
      expect(isHeartbeat({ type: "ping" })).toBe(false);
      expect(isHeartbeat({ type: "ping", seq: "1" })).toBe(false);
      expect(isHeartbeat({ type: "bark", seq: 0 })).toBe(false);
    });
  });

  describe("envelope", () => {
    const action = { type: "stop_session", hostId: "h", sessionId: "s" } as const;
    const envelope: RemoteEnvelope = wrapEnvelope(action);

    it("wraps a wire message with the current protocol version", () => {
      expect(envelope).toEqual({ v: REMOTE_PROTOCOL_VERSION, msg: action });
    });

    it("recognizes valid envelopes via the type guard", () => {
      expect(isRemoteEnvelope(envelope)).toBe(true);
      expect(isRemoteWireMessage(action)).toBe(true);
    });

    it("rejects envelopes with the wrong version or payload", () => {
      expect(isRemoteEnvelope({ ...envelope, v: 999 })).toBe(false);
      expect(isRemoteEnvelope({ v: REMOTE_PROTOCOL_VERSION, msg: { type: "no" } })).toBe(
        false,
      );
      expect(isRemoteEnvelope(null)).toBe(false);
    });

    it("serializes and parses envelopes losslessly", () => {
      expect(parseEnvelope(serializeEnvelope(action))).toEqual(envelope);
      expect(parseEnvelope("not json")).toBeNull();
      expect(
        parseEnvelope(
          JSON.stringify({ v: REMOTE_PROTOCOL_VERSION, msg: { type: "no" } }),
        ),
      ).toBeNull();
    });

    it("accepts pairing handshake messages", () => {
      const req = {
        type: "pairing_request",
        code: "ABCDEF",
        deviceName: "Phone",
        requestedAt: "2026-05-18T18:00:00Z",
      } as const;
      const resp = {
        type: "pairing_response",
        code: "ABCDEF",
        status: "accepted",
        hostId: "h",
        remoteToken: "tok",
      } as const;
      expect(isRemoteEnvelope(wrapEnvelope(req))).toBe(true);
      expect(isRemoteEnvelope(wrapEnvelope(resp))).toBe(true);
    });

    it("accepts auth and auth_response messages", () => {
      expect(
        isRemoteEnvelope(wrapEnvelope({ type: "auth", remoteToken: "tok" })),
      ).toBe(true);
      expect(
        isRemoteEnvelope(
          wrapEnvelope({ type: "auth_response", status: "accepted", hostId: "h" }),
        ),
      ).toBe(true);
      expect(
        isRemoteEnvelope(wrapEnvelope({ type: "auth", remoteToken: "" } as never)),
      ).toBe(false);
    });
  });
});
