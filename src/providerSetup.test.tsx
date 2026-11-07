import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ClaudeOnboardingOverlay } from "./App";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("opens Codex while Claude checks are pending without continuing or changing Claude setup", () => {
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  const open = vi.fn(), proceed = vi.fn(), recheck = vi.fn(), save = vi.fn(async () => true), clear = vi.fn(), terminal = vi.fn();
  try {
    act(() => root.render(<ClaudeOnboardingOverlay status={null} loading={true} authIssue="" tokenSaving={false} tokenError="" onOpenCodex={open} onContinue={proceed} onRecheck={recheck} onSaveToken={save} onClearToken={clear} onOpenTerminalCommand={terminal} />));
    const button = Array.from(element.querySelectorAll("button")).find(value => value.textContent?.trim() === "Open Codex preview")!;
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(proceed).not.toHaveBeenCalled(); expect(recheck).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled(); expect(terminal).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Checking Claude Code");
  } finally { act(() => root.unmount()); element.remove(); }
});

it("keeps the Codex entry and activity visible when Claude is missing or needs authentication", () => {
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  const open = vi.fn(), proceed = vi.fn();
  const status = { installed: false, authenticated: false, version: "", path: "", auth_method: "", api_provider: "", error: "Claude unavailable", managed_token_configured: false, managed_token_active: false, token_source: "none", token_error: "", auth_env_conflict: false, auth_needs_attention: false, auth_attention_reason: "" };
  try {
    act(() => root.render(<ClaudeOnboardingOverlay status={status} loading={false} authIssue="Claude sign-in failed" tokenSaving={true} tokenError="" onOpenCodex={open} codexActivity="approval" onContinue={proceed} onRecheck={() => {}} onSaveToken={async () => false} onClearToken={() => {}} onOpenTerminalCommand={() => {}} />));
    const button = Array.from(element.querySelectorAll("button")).find(value => value.textContent?.includes("Open Codex preview"))!;
    expect(button.disabled).toBe(false); expect(button.textContent).toContain("approval");
    act(() => button.click());
    expect(open).toHaveBeenCalledTimes(1); expect(proceed).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Claude sign-in failed");
    expect(element.textContent).toContain("not found on PATH");
  } finally { act(() => root.unmount()); element.remove(); }
});
