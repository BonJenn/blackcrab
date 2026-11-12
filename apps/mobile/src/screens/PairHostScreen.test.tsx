// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  TextInput: ({ accessibilityLabel, value, onChangeText, editable }: { accessibilityLabel: string; value: string; onChangeText: (value: string) => void; editable?: boolean }) => createElement("input", { "aria-label": accessibilityLabel, value, disabled: editable === false, onInput: (event: { currentTarget: HTMLInputElement }) => onChangeText(event.currentTarget.value) }),
  Pressable: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) => createElement("button", { onClick: onPress, disabled }, children),
  StyleSheet: { create: (value: unknown) => value },
  Platform: { OS: "ios" },
}));
vi.mock("expo-camera", () => ({ CameraView: () => null, useCameraPermissions: () => [null, vi.fn()] }));
vi.mock("expo-secure-store", () => ({ isAvailableAsync: async () => true }));
vi.mock("../transport/pairOverLan", async importOriginal => ({
  ...await importOriginal<typeof import("../transport/pairOverLan")>(),
  pairOverLan: vi.fn(),
}));
import { pairOverLan } from "../transport/pairOverLan";
import { PairHostScreen } from "./PairHostScreen";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("requires an address for a manual code and never reports pairing success after host rejection", async () => {
  const onPaired = vi.fn();
  const element = document.createElement("div"); document.body.append(element); const root = createRoot(element);
  const enter = (label: string, value: string) => act(() => {
    const field = element.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    field.value = value; field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const pairButton = () => Array.from(element.querySelectorAll("button")).find(button => button.textContent === "Pair desktop")!;
  try {
    act(() => root.render(<PairHostScreen onPaired={onPaired} />));
    enter("Pairing code or payload", "abcd-efgh");
    await act(async () => pairButton().click());
    expect(pairOverLan).not.toHaveBeenCalled();
    expect(onPaired).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Enter the desktop address and port");
    enter("Desktop address and port", "desktop.local:8124");
    vi.mocked(pairOverLan).mockRejectedValueOnce(new Error("Desktop rejected the pairing."));
    await act(async () => pairButton().click());
    expect(pairOverLan).toHaveBeenCalledWith({ type: "manual_address", code: "ABCDEFGH", lanHost: "desktop.local", lanPort: 8124 }, { deviceName: "Phone (ios)" });
    expect(onPaired).not.toHaveBeenCalled();
    expect(element.textContent).toContain("Desktop rejected the pairing.");
    expect(element.textContent).not.toContain("Local demo");
  } finally { act(() => root.unmount()); element.remove(); }
});
