import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ os: "ios", root: "file:///app/" as string | null, files: new Map<string,string>() }));
vi.mock("react-native", () => ({ Platform: { get OS() { return env.os; } } }));
vi.mock("../queue/storage", () => ({ queueId: () => "temporary-id" }));
vi.mock("expo-file-system/legacy", () => ({
  get documentDirectory() { return env.root; },
  getInfoAsync: vi.fn(async (file: string) => ({ exists: env.files.has(file) })),
  readAsStringAsync: vi.fn(async (file: string) => env.files.get(file)),
  writeAsStringAsync: vi.fn(async (file: string, value: string) => { env.files.set(file, value); }),
  makeDirectoryAsync: vi.fn(async () => {}),
  moveAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => { env.files.set(to, env.files.get(from)!); env.files.delete(from); }),
  deleteAsync: vi.fn(async (file: string) => { env.files.delete(file); }),
}));
import * as FileSystem from "expo-file-system/legacy";
import { draftStorage } from "./storage";
beforeEach(() => { env.files.clear(); env.os = "ios"; env.root = "file:///app/"; vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });
it("uses safe host/session file identities and retains the old record when replacement fails", async () => {
  const key = JSON.stringify(["host/../private", "session"]);
  await draftStorage.write(key, "old record");
  const path = [...env.files.keys()][0]; expect(path).toMatch(/^file:\/\/\/app\/drafts-v1\/[a-f0-9]{128}\.json$/);
  expect(await draftStorage.read(key)).toBe("old record");
  vi.mocked(FileSystem.moveAsync).mockRejectedValueOnce(new Error("disk failure"));
  await expect(draftStorage.write(key, "new record")).rejects.toThrow("disk failure");
  expect(env.files.get(path)).toBe("old record"); expect(env.files.size).toBe(1);
  expect(await draftStorage.read(JSON.stringify(["different", "session"]))).toBeNull();
});
it("uses a distinct browser namespace and reports unavailable durable native storage", async () => {
  const values = new Map<string,string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  env.os = "web"; await draftStorage.write("identity", "draft");
  expect([...values.keys()][0]).toMatch(/^blackcrab\.mobile\.draft\.v1\.[a-f0-9]{128}$/);
  expect(await draftStorage.read("identity")).toBe("draft"); expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  env.os = "ios"; env.root = null;
  await expect(draftStorage.write("identity", "draft")).rejects.toThrow("storage unavailable");
});
