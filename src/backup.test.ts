import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFilename,
  buildBackup,
  parseBackup,
  type SessionOverride,
} from "./backup";

const overrides: SessionOverride[] = [
  { id: "sess-1", cwd: "/tmp/proj", customTitle: "Renamed", archived: true },
  { id: "sess-2", cwd: "/tmp/other", archived: false },
];

describe("backup helpers", () => {
  it("round-trips build -> stringify -> parse", () => {
    const built = buildBackup(
      { theme: "jet", "usage.budget.v1": '{"monthlyCostUsd":50}' },
      overrides,
      { generatedAt: "2026-06-01T12:00:00.000Z", appVersion: "0.2.0" },
    );
    expect(built.format).toBe(BACKUP_FORMAT);
    expect(built.version).toBe(BACKUP_VERSION);

    const parsed = parseBackup(JSON.stringify(built));
    expect(parsed.settings.theme).toBe("jet");
    expect(parsed.appVersion).toBe("0.2.0");
    expect(parsed.sessionOverrides).toHaveLength(2);
    expect(parsed.sessionOverrides[0].customTitle).toBe("Renamed");
  });

  it("derives a dated filename", () => {
    expect(backupFilename("2026-06-01T12:00:00.000Z")).toBe(
      "blackcrab-backup-2026-06-01.json",
    );
  });

  it("rejects malformed JSON", () => {
    expect(() => parseBackup("{not json")).toThrow(/valid JSON/);
  });

  it("rejects files that aren't Blackcrab backups", () => {
    expect(() => parseBackup(JSON.stringify({ format: "something-else" }))).toThrow(
      /not a Blackcrab backup/,
    );
  });

  it("rejects a backup from a newer app version", () => {
    const future = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION + 1,
      settings: {},
      sessionOverrides: [],
    });
    expect(() => parseBackup(future)).toThrow(/newer than this app supports/);
  });

  it("tolerates missing settings / overrides fields", () => {
    const parsed = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION }),
    );
    expect(parsed.settings).toEqual({});
    expect(parsed.sessionOverrides).toEqual([]);
  });
});
