import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ platform: { OS: "ios" }, available: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("react-native", () => ({ Platform: f.platform }));
vi.mock("expo-secure-store", () => ({ isAvailableAsync: f.available, getItemAsync: f.read, setItemAsync: f.write }));
import { hostSelectionStorage, HOST_SELECTION_KEY } from "./hostSelectionStorage";
beforeEach(() => { vi.clearAllMocks(); f.platform.OS = "ios"; f.available.mockResolvedValue(true); f.read.mockResolvedValue(null); f.write.mockResolvedValue(undefined); vi.unstubAllGlobals(); });
it("uses a single secure native preference without touching pairing credentials", async () => {
  f.read.mockResolvedValue('{"version":1,"hostId":"one"}');
  expect(await hostSelectionStorage.read()).toContain("one"); await hostSelectionStorage.write('{"version":1,"hostId":null}');
  expect(f.read).toHaveBeenCalledExactlyOnceWith(HOST_SELECTION_KEY); expect(f.write).toHaveBeenCalledExactlyOnceWith(HOST_SELECTION_KEY, '{"version":1,"hostId":null}');
});
it("reports unavailable native storage and read/write failures without an in-memory fallback", async () => {
  f.available.mockResolvedValue(false); await expect(hostSelectionStorage.read()).rejects.toThrow(); await expect(hostSelectionStorage.write("data")).rejects.toThrow(); expect(f.read).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  f.available.mockResolvedValue(true); f.read.mockRejectedValue(new Error("read")); f.write.mockRejectedValue(new Error("write"));
  await expect(hostSelectionStorage.read()).rejects.toThrow("read"); await expect(hostSelectionStorage.write("data")).rejects.toThrow("write");
});
it("uses web localStorage and surfaces browser storage errors", async () => {
  f.platform.OS = "web"; const read = vi.fn(() => null), write = vi.fn(); vi.stubGlobal("localStorage", { getItem: read, setItem: write });
  expect(await hostSelectionStorage.read()).toBeNull(); await hostSelectionStorage.write("data"); expect(write).toHaveBeenCalledExactlyOnceWith(HOST_SELECTION_KEY, "data"); expect(f.available).not.toHaveBeenCalled();
  write.mockImplementation(() => { throw new Error("quota"); }); await expect(hostSelectionStorage.write("data")).rejects.toThrow("quota");
});
