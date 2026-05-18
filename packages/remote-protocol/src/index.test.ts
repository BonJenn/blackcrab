import { describe, expect, it } from "vitest";

import {
  createDesktopPairingPayload,
  DESKTOP_PAIRING_PAYLOAD_TYPE,
  hasDesktopPairingPayloadExpired,
  isDesktopPairingPayload,
  isHostPlatform,
  isPairingCode,
  isRemoteAction,
  isRemoteEvent,
  parseDesktopPairingPayload,
  REMOTE_PROTOCOL_VERSION,
  serializeDesktopPairingPayload,
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
