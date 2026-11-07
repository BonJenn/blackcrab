import { invoke } from "@tauri-apps/api/core";

export type CodexPage<T> = { data: T[]; nextCursor: string | null; backwardsCursor: string | null };
export type CodexThread = { id: string; name: string | null; preview: string; cwd: string; createdAt: number; updatedAt: number; modelProvider: string; model: string | null; historyMode: string; status: unknown };
export type CodexModel = { id: string; model: string; displayName: string; description: string; isDefault: boolean; defaultReasoningEffort: string; supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>; inputModalities: string[]; serviceTiers: Array<{ id: string; name: string; description: string }>; defaultServiceTier: string | null };
export type CodexAccount = { account: { type: string; email?: string | null; planType?: string; workspaceName?: string | null } | null; requiresOpenaiAuth: boolean };
export type CodexTurn = { id: string; status: string; error: unknown; itemsView: "notLoaded" | "summary" | "full"; items: unknown[]; startedAt: number | null; completedAt: number | null; durationMs: number | null };
export type CodexItem = { turnId: string; item: unknown; startedAtMs: number | null; completedAtMs: number | null };
export type PageArgs = { cursor?: string | null; limit?: number };
export type CodexQuery =
  | { type: "account" }
  | { type: "models"; page: PageArgs }
  | { type: "threads"; page: PageArgs; cwd?: string; archived?: boolean }
  | { type: "thread"; threadId: string }
  | { type: "turns"; threadId: string; page: PageArgs; itemsView?: "notLoaded" | "summary" | "full" }
  | { type: "items"; threadId: string; turnId?: string; page: PageArgs };
type Results = { account: CodexAccount; models: CodexPage<CodexModel>; threads: CodexPage<CodexThread>; thread: CodexThread; turns: CodexPage<CodexTurn>; items: CodexPage<CodexItem> };
const inFlight = new Map<string, Promise<unknown>>();
export function codexQuery<Q extends CodexQuery>(query: Q): Promise<Results[Q["type"]]> {
  const key = JSON.stringify(query);
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<Results[Q["type"]]>;
  const request = readCodexQuery(query);
  inFlight.set(key, request);
  const clear = () => { if (inFlight.get(key) === request) inFlight.delete(key); };
  void request.then(clear, clear);
  return request;
}
async function readCodexQuery<Q extends CodexQuery>(query: Q): Promise<Results[Q["type"]]> {
  const reply = await invoke<{ provider: string; result: { type: string; data: Results[Q["type"]] } }>("codex_query", { query });
  if (reply?.provider !== "codex" || reply.result?.type !== query.type || !reply.result.data || typeof reply.result.data !== "object") throw new Error("Unexpected Codex response");
  if ("page" in query) {
    const page = reply.result.data as CodexPage<unknown>;
    if (!Array.isArray(page.data) || (page.nextCursor !== null && typeof page.nextCursor !== "string")) throw new Error("Invalid Codex page");
    if (page.nextCursor && page.nextCursor === query.page.cursor) throw new Error("Codex history cursor did not advance");
  }
  return reply.result.data;
}

export function historyItem(value: unknown): { id?: string; type: string; text: string } {
  if (!value || typeof value !== "object") return { type: "Unknown item", text: JSON.stringify(value) ?? "" };
  const item = value as Record<string, unknown>;
  // Text is always rendered by React, never interpreted as HTML or a command.
  const labels: Record<string, string> = { userMessage: "You", agentMessage: "Assistant", reasoning: "Reasoning", commandExecution: "Command", fileChange: "File changes", mcpToolCall: "Tool call", webSearch: "Web search" };
  const kind = typeof item.type === "string" ? item.type : "Unknown item";
  let text = typeof item.text === "string" ? item.text : JSON.stringify(item, null, 2);
  if (kind === "userMessage" && Array.isArray(item.content)) {
    text = item.content.map(value => value && typeof value === "object" && "text" in value && typeof value.text === "string" ? value.text : JSON.stringify(value)).join("\n");
  } else if (kind === "commandExecution" && typeof item.command === "string") {
    text = item.command + (typeof item.aggregatedOutput === "string" ? `\n\n${item.aggregatedOutput}` : "");
  }
  return { id: typeof item.id === "string" ? item.id : undefined, type: labels[kind] ?? kind, text };
}
