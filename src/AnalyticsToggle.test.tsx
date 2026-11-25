import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalyticsToggle } from "./AnalyticsToggle";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); });
const box = () => host.querySelector("input")!;
it("shows the saved choice and saves a change through the app", async () => {
  api.invoke.mockResolvedValueOnce(true);
  await act(() => root.render(<AnalyticsToggle />));
  expect(api.invoke).toHaveBeenCalledWith("product_analytics_enabled");
  expect(box().checked).toBe(true);
  api.invoke.mockResolvedValueOnce(false);
  await act(() => box().click());
  expect(api.invoke).toHaveBeenLastCalledWith("set_product_analytics_enabled", { enabled: false });
  expect(box().checked).toBe(false);
});
it("stays disabled and says so when the setting cannot be read", async () => {
  api.invoke.mockRejectedValueOnce("no");
  await act(() => root.render(<AnalyticsToggle />));
  expect(box().disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not read");
});
