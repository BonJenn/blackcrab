import { expect, it } from "vitest";
import { readServiceStatus } from "./managedServiceClient";
it("accepts only the public service-status contract", () => {
  const value = { state: "running", canInitialize: false, installed: true, loaded: true };
  expect(readServiceStatus(value)).toEqual(value);
  for (const invalid of [null, [], { ...value, state: "foreign" }, { ...value, loaded: "yes" }, { ...value, ownerSecret: "not public" }]) expect(() => readServiceStatus(invalid)).toThrow();
});
