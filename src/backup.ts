// Backup & Restore serialization helpers.
//
// Blackcrab keeps its user-owned state in a handful of localStorage keys plus
// per-session overrides (custom titles, archived state) that the backend writes
// into Claude Code's session files. This module defines the portable backup
// format and the pure build/parse logic; the localStorage and Tauri side
// effects live in App.tsx so this stays unit-testable.

export const BACKUP_FORMAT = "blackcrab-backup";
export const BACKUP_VERSION = 1;

// Every app-owned localStorage key captured by a backup. Intentionally EXCLUDES
// `blackcrab.analyticsInstallId` — that identity should not be cloned onto a
// second machine or duplicated by a restore.
export const BACKUP_KEYS: readonly string[] = [
  "blackcrab.settings",
  "composerDrafts",
  "sidebar.sessionActivity",
  "usage.history.v1",
  "usage.budget.v1",
  "gridMode",
  "gridPanels",
  "gridPanelSessionIds",
  "newPanelWorktree",
  "newPanelCwds",
  "gridRowTopFraction",
  "gridColWeightsByCount",
  "sidebarWidth",
  "previewWidth",
  "terminalHeight",
  "theme",
  "sidebar.groupByProject",
  "sidebar.showArchived",
  "sidebar.attentionOnly",
  "blackcrab.savedLayouts.v1",
];

export type SessionOverride = {
  id: string;
  cwd: string;
  customTitle?: string;
  archived: boolean;
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  generatedAt: string;
  appVersion: string;
  // Raw localStorage string values, keyed by storage key. Lossless and
  // decoupled from each key's own schema.
  settings: Record<string, string>;
  sessionOverrides: SessionOverride[];
};

/** Assemble a backup object from a localStorage snapshot and session overrides. */
export function buildBackup(
  settings: Record<string, string>,
  sessionOverrides: SessionOverride[],
  meta: { generatedAt: string; appVersion: string },
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    generatedAt: meta.generatedAt,
    appVersion: meta.appVersion,
    settings,
    sessionOverrides,
  };
}

/** Default filename for an exported backup, e.g. blackcrab-backup-2026-06-01.json. */
export function backupFilename(iso: string): string {
  const day = iso.slice(0, 10);
  return `blackcrab-backup-${day}.json`;
}

/**
 * Parse and validate backup text. Throws a clear Error on malformed JSON, an
 * unrecognized format, or a version newer than this build can restore.
 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file.");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Backup file is empty or malformed.");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== BACKUP_FORMAT) {
    throw new Error("This file is not a Blackcrab backup.");
  }
  if (typeof obj.version !== "number" || obj.version > BACKUP_VERSION) {
    throw new Error(
      `Backup version ${String(obj.version)} is newer than this app supports.`,
    );
  }
  const settings =
    obj.settings && typeof obj.settings === "object"
      ? (obj.settings as Record<string, string>)
      : {};
  const sessionOverrides = Array.isArray(obj.sessionOverrides)
    ? (obj.sessionOverrides as SessionOverride[])
    : [];
  return {
    format: BACKUP_FORMAT,
    version: obj.version,
    generatedAt: typeof obj.generatedAt === "string" ? obj.generatedAt : "",
    appVersion: typeof obj.appVersion === "string" ? obj.appVersion : "",
    settings,
    sessionOverrides,
  };
}
