import { invoke } from "@tauri-apps/api/core";
import type { QueueChange, QueueSnapshot, TurnReceipt } from "./queueClient";

export type CodexContext = {
  provider: "codex";
  threadId: string;
  runId: string;
  providerSessionId: string;
  processFinished: boolean;
};
export type CodexAction =
  | { type: "submit"; commandId: string; text: string; queued?: boolean }
  | { type: "queue" }
  | { type: "changeQueue"; expectedRevision: number; change: QueueChange }
  | { type: "interrupt" }
  | { type: "answer"; approvalId: string; decision: "accept" | "decline" | "cancel" }
  | { type: "stop" };
type Results = {
  submit: TurnReceipt;
  queue: QueueSnapshot;
  changeQueue: QueueSnapshot;
  interrupt: void;
  answer: void;
  stop: void;
};
function contextValid(context: CodexContext): boolean {
  return context?.provider === "codex" && [context.runId, context.threadId, context.providerSessionId].every(value => typeof value === "string" && value.length > 0) && typeof context.processFinished === "boolean";
}
export async function codexContext(panelId: string): Promise<CodexContext> {
  const context = await invoke<CodexContext>("session_execution", { panelId });
  if (!contextValid(context)) throw new Error("This panel does not have an identified Codex session");
  return context;
}

/** Every action includes the intended run. Never fall back to unguarded panel APIs. */
export async function codexControl<A extends CodexAction>(panelId: string, context: CodexContext, action: A): Promise<Results[A["type"]]> {
  if (!panelId || !contextValid(context)) throw new Error("Refresh the Codex session before continuing");
  if (context.processFinished && action.type !== "queue" && action.type !== "stop") throw new Error("Codex runtime ended; resume the original session before continuing");
  const reply = await invoke<{ type: string; data?: unknown }>("codex_control", { panelId, expectedRunId: context.runId, action });
  if (action.type === "submit") {
    const receipt = reply?.data as TurnReceipt | undefined;
    if (reply?.type !== "receipt" || !receipt || receipt.threadId !== context.threadId || receipt.commandId !== action.commandId || typeof receipt.turnId !== "string" || typeof receipt.status !== "string") throw new Error("Codex returned a receipt for a different command or session");
    return receipt as Results[A["type"]];
  }
  if (action.type === "queue" || action.type === "changeQueue") {
    const queue = reply?.data as QueueSnapshot | undefined;
    if (reply?.type !== "queue" || !queue || queue.threadId !== context.threadId || !Number.isSafeInteger(queue.revision) || queue.revision < 0 || typeof queue.paused !== "boolean" || !Array.isArray(queue.items)) throw new Error("Codex returned an invalid queue for this session");
    return queue as Results[A["type"]];
  }
  if (reply?.type !== "done") throw new Error("Could not confirm the Codex action");
  return undefined as Results[A["type"]];
}
