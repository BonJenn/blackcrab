import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { codexContext, codexControl, type CodexAction, type CodexContext } from "./codexControl";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const call = vi.mocked(invoke);
const context: CodexContext = { provider: "codex", runId: "run-1", threadId: "journal-thread", providerSessionId: "native-thread", processFinished: false };
const receipt = { commandId: "stable-command", threadId: context.threadId, turnId: "journal-turn", status: "running" };
const queue = { threadId: context.threadId, revision: 1, paused: true, items: [] };
beforeEach(() => call.mockReset());
it("requires provider, native session and journal/run identity on context reads", async () => {
  call.mockResolvedValueOnce(context);
  expect(await codexContext("panel")).toEqual(context);
  for (const invalid of [{ ...context, provider: "claude" }, { ...context, providerSessionId: null }, { ...context, runId: "" }]) {
    call.mockResolvedValueOnce(invalid);
    await expect(codexContext("panel")).rejects.toThrow("identified Codex");
  }
});
it("sends every typed operation through the guarded endpoint with its original run", async () => {
  const actions: CodexAction[] = [
    { type: "submit", commandId: "stable-command", text: "body" },
    { type: "submit", commandId: "stable-command", text: "body", queued: true },
    { type: "queue" },
    { type: "changeQueue", expectedRevision: 1, change: { type: "resume" } },
    { type: "interrupt" },
    { type: "answer", approvalId: "opaque-id", decision: "decline" },
    { type: "stop" },
  ];
  for (const action of actions) {
    call.mockResolvedValueOnce(action.type === "submit" ? { type: "receipt", data: receipt } : action.type === "queue" || action.type === "changeQueue" ? { type: "queue", data: queue } : { type: "done" });
    await codexControl("panel", context, action);
    expect(call).toHaveBeenLastCalledWith("codex_control", { panelId: "panel", expectedRunId: "run-1", action });
  }
});
it("does not fall back or retry after a stale-run rejection", async () => {
  call.mockRejectedValueOnce(new Error("Codex session changed"));
  await expect(codexControl("panel", context, { type: "stop" })).rejects.toThrow("changed");
  expect(call).toHaveBeenCalledTimes(1);
});
it("rejects cross-command/session receipts and malformed queues", async () => {
  for (const data of [{ ...receipt, commandId: "other" }, { ...receipt, threadId: "other" }]) {
    call.mockResolvedValueOnce({ type: "receipt", data });
    await expect(codexControl("panel", context, { type: "submit", commandId: "stable-command", text: "body" })).rejects.toThrow("different command");
  }
  for (const data of [{ ...queue, threadId: "other" }, { ...queue, revision: -1 }, { ...queue, items: "bad" }]) {
    call.mockResolvedValueOnce({ type: "queue", data });
    await expect(codexControl("panel", context, { type: "queue" })).rejects.toThrow("invalid queue");
  }
  call.mockResolvedValueOnce({ type: "receipt", data: receipt });
  await expect(codexControl("panel", context, { type: "interrupt" })).rejects.toThrow("confirm");
});
it("blocks writes for finished or unidentified contexts while allowing guarded queue/stop recovery", async () => {
  const stopped = { ...context, processFinished: true };
  for (const action of [{ type: "submit", commandId: "stable-command", text: "body" }, { type: "interrupt" }, { type: "answer", approvalId: "id", decision: "accept" }] satisfies CodexAction[]) {
    await expect(codexControl("panel", stopped, action)).rejects.toThrow("ended");
  }
  await expect(codexControl("", context, { type: "stop" })).rejects.toThrow("Refresh");
  expect(call).not.toHaveBeenCalled();
  call.mockResolvedValueOnce({ type: "queue", data: queue });
  expect(await codexControl("panel", stopped, { type: "queue" })).toEqual(queue);
  call.mockResolvedValueOnce({ type: "done" });
  await codexControl("panel", stopped, { type: "stop" });
});
