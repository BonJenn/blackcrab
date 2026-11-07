import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { QueueControls } from "./QueueControls";
import { queueClient, type QueueState } from "./queueClient";

it("preserves an open edit and blocks stale saves until the latest message is reopened", () => {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const mutate = vi.spyOn(queueClient, "mutate");
  const state: QueueState = { context: null, loading: false, saving: false, pending: null, error: null,
    queue: { threadId: "thread", revision: 1, paused: true, items: [{ commandId: "command", turnId: "turn", text: "original", createdAtMs: 1, updatedAtMs: 1 }] } };
  const render = () => act(() => root.render(<QueueControls panelId="panel" state={state} busy={false} ensureSession={async () => {}} live={true} />));
  const button = (text: string) => Array.from(element.querySelectorAll("button")).find(value => value.textContent === text)!;
  try {
    render();
    act(() => button("Edit").click());
    expect(element.querySelector("textarea")?.value).toBe("original");
    state.queue = { ...state.queue!, revision: 2, items: [{ ...state.queue!.items[0], text: "edited elsewhere" }] };
    render();
    expect(element.querySelector("textarea")?.value).toBe("original");
    expect(button("Save message").disabled).toBe(true);
    expect(element.textContent).toContain("Queue changed");
    act(() => button("Save message").click());
    expect(mutate).not.toHaveBeenCalled();
    act(() => button("Cancel edit").click());
    act(() => button("Edit").click());
    expect(element.querySelector("textarea")?.value).toBe("edited elsewhere");
    expect(button("Save message").disabled).toBe(false);
  } finally {
    act(() => root.unmount());
    element.remove();
    mutate.mockRestore();
  }
});
