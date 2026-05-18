import { describe, expect, it, vi } from "vitest";

import { PairingClient, type PairingInvoker } from "./pairing";

function makeClient() {
  const handler = vi.fn(
    async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
      switch (command) {
        case "pairing_start":
          return { code: "ABCDEFGH", expiresAtMs: 1_700_000_300_000 };
        case "pairing_accept":
          return {
            remoteToken: "0".repeat(64),
            pairedDevice: {
              deviceId: `dev_${args?.code ?? "x"}`,
              displayName: String(args?.deviceName ?? ""),
              pairedAtMs: 1_700_000_000_000,
              lastSeenAtMs: 1_700_000_000_000,
            },
          };
        case "pairing_cancel":
          return args?.code === "ABCDEFGH";
        case "pairing_list_devices":
          return [];
        case "pairing_revoke":
          return args?.deviceId === "dev_known";
        default:
          throw new Error(`unexpected command ${command}`);
      }
    },
  );
  const invoker: PairingInvoker = <T,>(
    command: string,
    args?: Record<string, unknown>,
  ) => handler(command, args) as Promise<T>;
  return { client: new PairingClient({ invoker }), invoker: handler };
}

describe("PairingClient", () => {
  it("invokes pairing_start without args", async () => {
    const { client, invoker } = makeClient();
    const response = await client.start();
    expect(response.code).toBe("ABCDEFGH");
    expect(invoker).toHaveBeenCalledWith("pairing_start", undefined);
  });

  it("passes camelCase args to pairing_accept", async () => {
    const { client, invoker } = makeClient();
    const response = await client.accept("ABCDEFGH", "Jonathan's iPhone");
    expect(response.pairedDevice.displayName).toBe("Jonathan's iPhone");
    expect(response.remoteToken).toHaveLength(64);
    expect(invoker).toHaveBeenCalledWith("pairing_accept", {
      code: "ABCDEFGH",
      deviceName: "Jonathan's iPhone",
    });
  });

  it("returns the boolean result from cancel and revoke", async () => {
    const { client } = makeClient();
    expect(await client.cancel("ABCDEFGH")).toBe(true);
    expect(await client.cancel("OTHERCODE")).toBe(false);
    expect(await client.revoke("dev_known")).toBe(true);
    expect(await client.revoke("dev_missing")).toBe(false);
  });

  it("returns the list of paired devices", async () => {
    const { client } = makeClient();
    expect(await client.listDevices()).toEqual([]);
  });
});
