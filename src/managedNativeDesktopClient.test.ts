import { afterEach, expect, it, vi } from "vitest";
import { managedNativeDesktopClient } from "./managedNativeDesktopClient";

afterEach(() => vi.unstubAllGlobals());

it("asks the real native bridge for bundle status when the convenience marker is missing", async () => {
  vi.stubGlobal("isTauri", undefined);
  const nativeInvoke = vi.fn().mockResolvedValue({ state: "ready" });
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: nativeInvoke });
  await expect(managedNativeDesktopClient.status()).resolves.toEqual({ state: "ready" });
  expect(nativeInvoke).toHaveBeenCalledWith("managed_native_desktop_status", {}, undefined);
});

it("reserves notBundled for an actual native response and preserves native errors", async () => {
  vi.stubGlobal("isTauri", false);
  const nativeInvoke = vi.fn().mockResolvedValue({ state: "notBundled" });
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: nativeInvoke });
  await expect(managedNativeDesktopClient.status()).resolves.toEqual({ state: "notBundled" });
  nativeInvoke.mockRejectedValue("Native desktop command was denied.");
  await expect(managedNativeDesktopClient.status()).rejects.toBe("Native desktop command was denied.");
});

it("does not misreport an absent native bridge as a missing desktop package", async () => {
  vi.stubGlobal("__TAURI_INTERNALS__", undefined);
  vi.stubGlobal("isTauri", undefined);
  await expect(managedNativeDesktopClient.status()).rejects.toThrow();
});
