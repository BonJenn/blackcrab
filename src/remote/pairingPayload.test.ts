import { describe, expect, it } from "vitest";
import {
  DESKTOP_PAIRING_PAYLOAD_TYPE,
  parseDesktopPairingPayload,
} from "@blackcrab/remote-protocol";

import { buildPairingPayload } from "./pairingPayload";

const hostInfo = {
  hostId: "desktop-studio",
  displayName: "studio",
  platform: "macos",
  appVersion: "0.2.0",
  online: true,
  lastSeenAtMs: 1_700_000_000_000,
};

const lan = { host: "192.168.1.5", port: 8124 };

describe("buildPairingPayload", () => {
  it("builds a typed payload using host metadata and the pairing start response", async () => {
    const built = await buildPairingPayload(
      { code: "ABCDEFGH", expiresAtMs: 1_700_000_300_000 },
      lan,
      async () => hostInfo,
    );

    expect(built.payload.type).toBe(DESKTOP_PAIRING_PAYLOAD_TYPE);
    expect(built.payload.hostId).toBe("desktop-studio");
    expect(built.payload.displayName).toBe("studio");
    expect(built.payload.platform).toBe("macos");
    expect(built.payload.appVersion).toBe("0.2.0");
    expect(built.payload.code).toBe("ABCDEFGH");
    expect(built.payload.expiresAtMs).toBe(1_700_000_300_000);
    expect(built.payload.lanHost).toBe(lan.host);
    expect(built.payload.lanPort).toBe(lan.port);
  });

  it("serializes to JSON that round-trips through parseDesktopPairingPayload", async () => {
    const built = await buildPairingPayload(
      { code: "ABCDEFGH", expiresAtMs: 1_700_000_300_000 },
      lan,
      async () => hostInfo,
    );

    const parsed = parseDesktopPairingPayload(built.serialized);
    expect(parsed).toEqual(built.payload);
  });

  it("normalizes a malformed host_info payload into safe defaults", async () => {
    const built = await buildPairingPayload(
      { code: "ABCDEFGH", expiresAtMs: 1_700_000_300_000 },
      lan,
      async () => ({ displayName: "" }) as unknown,
    );

    expect(built.payload.displayName).toBe("blackcrab-host");
    expect(built.payload.hostId).toBe("desktop-blackcrab-host");
    expect(built.payload.platform).toBe("unknown");
    expect(parseDesktopPairingPayload(built.serialized)).not.toBeNull();
  });
});
