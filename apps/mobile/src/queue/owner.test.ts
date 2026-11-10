import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import type { QueueRequestAction, RemoteEvent } from "@blackcrab/remote-protocol";
import type { Transport } from "../transport/types";

const native = vi.hoisted(() => ({ root: "" }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
// Exercise the actual queue/draft file layout and persistence. Node filesystem
// adapters stand in for Expo; this does not certify installed iOS behavior.
vi.mock("expo-file-system/legacy", async () => {
  const fs = await import("node:fs/promises");
  return {
    get documentDirectory() { return native.root; },
    getInfoAsync: async (file: string) => {
      try { await fs.stat(new URL(file)); return { exists: true }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false }; throw error; }
    },
    readAsStringAsync: (file: string) => fs.readFile(new URL(file), "utf8"),
    writeAsStringAsync: vi.fn((file: string, value: string) => fs.writeFile(new URL(file), value)),
    makeDirectoryAsync: (file: string) => fs.mkdir(new URL(file), { recursive: true }),
    moveAsync: ({ from, to }: { from: string; to: string }) => fs.rename(new URL(from), new URL(to)),
    deleteAsync: (file: string) => fs.rm(new URL(file), { force: true }),
  };
});
import * as FileSystem from "expo-file-system/legacy";
import { mobileQueue } from "./owner";
import { queueStorage } from "./storage";
import { MobileQueueClient } from "./client";
import { mobileDrafts } from "../drafts/useDraft";
import { draftStorage } from "../drafts/storage";
import { MobileDraftClient } from "../drafts/client";

let directory: string | undefined;
afterEach(async () => { mobileQueue.dispose(); if (directory) await rm(directory, { recursive: true, force: true }); });
it("retains one queue owner across detachment and reloads the pending file into a fresh controller", async () => {
  directory = await mkdtemp(join(tmpdir(), "blackcrab-queue-owner-"));
  native.root = pathToFileURL(directory).href + "/";
  const events = new Set<(event: RemoteEvent) => void>();
  const actions: QueueRequestAction[] = [];
  const transport: Transport = {
    status: () => ({ state: "connected", hostId: "host", sinceMs: 1 }),
    subscribe: () => () => {}, subscribeEvents: callback => { events.add(callback); return () => { events.delete(callback); }; },
    send: () => {}, close: () => {}, sendAction: action => { actions.push(action as QueueRequestAction); return true; },
  };
  const reply = (receipt: boolean) => {
    const action = actions.at(-1)!;
    const commandId = action.operation.type === "enqueue" ? action.operation.commandId : "";
    for (const callback of events) callback({ type: "queue_result", hostId: "host", sessionId: "session", requestId: action.requestId,
      ok: true, error: null, queue: { threadId: "thread", revision: 1, paused: true, items: [] },
      receipt: receipt ? { commandId, threadId: "thread", turnId: "held-turn", status: "held", createdAtMs: 1, updatedAtMs: 1, detail: null } : null });
  };
  await mobileDrafts.open("host", "session");
  mobileDrafts.edit("host", "session", "kept across upgrade"); await mobileDrafts.retrySave("host", "session");
  const draft = { editId: mobileDrafts.state("host", "session").editId, text: "kept across upgrade" };
  mobileQueue.bind(transport, "host"); await mobileQueue.open("host", "session"); reply(false);
  let release!: () => void;
  const saving = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(FileSystem.writeAsStringAsync).mockImplementationOnce(async (file, value) => { await saving; await writeFile(new URL(file), value); });
  const first = mobileQueue.enqueue("host", "session", draft.text, draft);
  // The full app unmounts LegacyApp; its connection effect detaches this owner.
  mobileQueue.bind(null, null);
  const reopenedOwner = (await import("./owner")).mobileQueue;
  reopenedOwner.bind(transport, "host"); await reopenedOwner.open("host", "session");
  expect(reopenedOwner.state("host", "session").busy).toBe(true);
  expect(await reopenedOwner.enqueue("host", "session", "would overwrite")).toBe(false);
  release(); expect(await first).toBe(true);
  const pending = reopenedOwner.state("host", "session").pending!;
  const files = await readdir(join(directory, "queue-recovery-v1"));
  expect(files).toHaveLength(1); expect(files[0]).toMatch(/^[a-f0-9]{128}\.json$/);
  expect(JSON.parse(await readFile(join(directory, "queue-recovery-v1", files[0]), "utf8"))).toEqual(pending);
  reopenedOwner.dispose();
  // A fresh controller reads the same file without replacing its ID.
  const restoredDrafts = new MobileDraftClient(draftStorage, () => "fresh-draft-id");
  await restoredDrafts.open("host", "session");
  const restored = new MobileQueueClient(queueStorage, () => "new-request", 1000,
    (host, session, transfer) => restoredDrafts.confirmTransfer(host, session, transfer));
  try {
    restored.bind(transport, "host"); await restored.open("host", "session"); reply(false);
    expect(restored.state("host", "session").pending).toEqual(pending);
    expect(actions.filter(action => action.operation.type === "enqueue")).toHaveLength(0);
    restored.retry("host", "session");
    expect(actions.at(-1)!.operation).toEqual({ type: "enqueue", commandId: pending.commandId, body: pending.body });
    reply(true);
    await expect.poll(() => restored.state("host", "session").pending).toBeNull();
    expect(await readdir(join(directory, "queue-recovery-v1"))).toEqual([]);
    expect(restoredDrafts.state("host", "session").text).toBe("");
    const draftFiles = await readdir(join(directory, "drafts-v1"));
    expect(JSON.parse(await readFile(join(directory, "drafts-v1", draftFiles[0]), "utf8")).text).toBe("");
  } finally { restored.dispose(); }
  expect(events.size).toBe(0);
});
