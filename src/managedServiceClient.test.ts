import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { managedServiceClient, readServiceStatus } from "./managedServiceClient";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
it("checks native service availability even without the JavaScript runtime marker", async () => {
  const value = { state: "running", canInitialize: false, installed: true, loaded: true };
  vi.mocked(invoke).mockResolvedValue(value);
  expect(await managedServiceClient.status()).toEqual(value);
  expect(invoke).toHaveBeenCalledWith("managed_service_control", { action: "status" });
});
it("accepts only the public service-status contract", () => {
  const value = { state: "running", canInitialize: false, installed: true, loaded: true };
  expect(readServiceStatus(value)).toEqual(value);
  for (const invalid of [null, [], { ...value, state: "foreign" }, { ...value, loaded: "yes" }, { ...value, ownerSecret: "not public" }]) expect(() => readServiceStatus(invalid)).toThrow();
});
