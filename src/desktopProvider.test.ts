import { expect, it, vi } from "vitest";
import { DESKTOP_PROVIDER_KEY, readDesktopProvider, saveDesktopProvider } from "./desktopProvider";
it("restores only recognized provider preferences and handles unavailable storage", () => {
  for (const saved of [null, "claude", "unknown", "{corrupt}"]) expect(readDesktopProvider({ getItem: () => saved })).toBe("claude");
  expect(readDesktopProvider({ getItem: () => "codex" })).toBe("codex");
  expect(readDesktopProvider({ getItem: () => { throw new Error("unavailable"); } })).toBe("claude");
  const setItem = vi.fn();
  expect(saveDesktopProvider({ setItem }, "codex")).toBe(true);
  expect(setItem).toHaveBeenCalledWith(DESKTOP_PROVIDER_KEY, "codex");
  expect(saveDesktopProvider({ setItem: () => { throw new Error("quota"); } }, "claude")).toBe(false);
});
