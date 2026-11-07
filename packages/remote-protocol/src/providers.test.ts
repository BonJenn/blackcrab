import { expect, it } from "vitest";
import { isRemoteEvent, isRemoteProviderInfo, parseEnvelope } from "./index";
const provider = { id: "codex", displayName: "Codex", installed: true, desktopReady: false, remoteReady: false, capabilities: { resume: true, streaming: true, modelSelection: true, permissionModes: ["default", "readOnly"], worktrees: false, steering: false } };
it("strictly validates read-only provider requests and protocol versions", () => {
  const msg = { type: "providers_request", hostId: "host", requestId: "read-1" };
  expect(parseEnvelope(JSON.stringify({ v: 1, msg }))).not.toBeNull();
  for (const patch of [{ requestId: "" }, { requestId: " x" }, { requestId: "é" }, { requestId: "x".repeat(129) }, { hostId: " " }, { hostId: "x".repeat(1025) }, { provider: "claude" }]) expect(parseEnvelope(JSON.stringify({ v: 1, msg: { ...msg, ...patch } }))).toBeNull();
  expect(parseEnvelope(JSON.stringify({ v: 2, msg }))).toBeNull();
  expect(parseEnvelope(JSON.stringify({ v: 1, msg, extra: true }))).toBeNull();
});
it("requires correlated explicit success or failure with unique typed providers", () => {
  const result = { type: "providers_result", hostId: "host", requestId: "read-1", ok: true, error: null, providers: [provider] };
  expect(isRemoteEvent(result)).toBe(true);
  expect(isRemoteEvent({ ...result, ok: false, error: "unavailable", providers: null })).toBe(true);
  for (const patch of [{ requestId: "" }, { ok: false }, { error: "failure" }, { providers: null }, { providers: [provider, provider] }, { providers: [{ ...provider, id: "unknown" }] }, { providers: [{ ...provider, installed: "yes" }] }, { providers: [{ ...provider, capabilities: { ...provider.capabilities, permissionModes: ["x", "x"] } }] }, { extra: true }]) expect(isRemoteEvent({ ...result, ...patch })).toBe(false);
  expect(isRemoteProviderInfo({ ...provider, id: ["codex"] })).toBe(false);
});
