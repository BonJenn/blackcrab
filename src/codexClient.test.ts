import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { codexQuery, historyItem } from "./codexClient";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
it("rejects cross-provider, wrong-kind and non-advancing pages", async () => {
  for (const value of [
    { provider: "claude", result: { type: "models", data: { data: [], nextCursor: null } } },
    { provider: "codex", result: { type: "threads", data: { data: [], nextCursor: null } } },
    { provider: "codex", result: { type: "models", data: { data: [], nextCursor: "same" } } },
    { provider: "codex", result: { type: "models", data: { data: "bad", nextCursor: null } } },
  ]) {
    vi.mocked(invoke).mockResolvedValueOnce(value);
    await expect(codexQuery({ type: "models", page: { cursor: "same" } })).rejects.toThrow();
  }
});
it("keeps text and unknown history as inert content and renders common item forms", () => {
  expect(historyItem({ type: "userMessage", content: [{ type: "text", text: "<script>unsafe()</script>" }] }).text).toBe("<script>unsafe()</script>");
  expect(historyItem({ type: "commandExecution", command: "echo fixture", aggregatedOutput: "output" }).text).toBe("echo fixture\n\noutput");
  expect(historyItem({ type: "futureItem", payload: "retained" }).text).toContain("retained");
});

it("shares identical pending reads without caching settled account/history data", async () => {
  vi.mocked(invoke).mockClear();
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const first = codexQuery({ type: "account" });
  const second = codexQuery({ type: "account" });
  expect(first).toBe(second);
  expect(invoke).toHaveBeenCalledTimes(1);
  finish({ provider: "codex", result: { type: "account", data: { account: null, requiresOpenaiAuth: false } } });
  await first;
  vi.mocked(invoke).mockResolvedValueOnce({ provider: "codex", result: { type: "account", data: { account: { type: "apiKey" }, requiresOpenaiAuth: true } } });
  expect((await codexQuery({ type: "account" })).account?.type).toBe("apiKey");
  expect(invoke).toHaveBeenCalledTimes(2);
});
