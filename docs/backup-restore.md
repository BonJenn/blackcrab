# Backup & Restore

Blackcrab is local-first: your preferences, layout, usage history, budgets,
drafts, and per-session overrides live only on your machine. Backup & Restore
lets you export that state to a single JSON file and restore it later — to move
to another machine or recover from accidental loss.

Open **Settings → Backup & Restore** and use **Export backup…** / **Import
backup…**.

## What's included

A backup is a single `blackcrab-backup-<date>.json` file containing:

- **App settings** — default model, permission mode, startup directory,
  notification/update/preview/analytics toggles, density, and worktree mode
  (`blackcrab.settings`).
- **Layout** — grid mode and panels, panel→session mappings, new-panel cwd and
  worktree choices, grid row/column sizing, sidebar and preview widths, terminal
  height, theme, and sidebar grouping/filter toggles.
- **Usage** — saved usage history (`usage.history.v1`) and budget thresholds
  (`usage.budget.v1`).
- **Drafts** — unsent composer drafts (`composerDrafts`).
- **Session activity** — per-session activity/unread markers
  (`sidebar.sessionActivity`).
- **Per-session overrides** — for each session, the custom title you set and its
  archived state. Only explicitly set overrides are captured, so restoring never
  pins an auto-generated title.

## What's intentionally excluded

- **Conversation transcripts** (`~/.claude/projects`). These are owned and
  managed by Claude Code, can be large, and use machine-specific working-directory
  paths. Back them up through Claude Code or your own file backups.
- **Your sign-in token.** The Claude OAuth token lives in the OS keychain and is
  never written to a backup. After restoring on a new machine, re-authenticate
  via Settings → Claude.
- **The analytics install id** (`blackcrab.analyticsInstallId`). It is
  deliberately not cloned; a restored copy generates its own.

## How restore works

Importing a backup:

1. Validates the file (format and version; a backup from a newer app version is
   rejected).
2. Asks for confirmation, noting that current settings, layout, usage history,
   and drafts will be replaced.
3. Writes the saved settings back into local storage.
4. Re-applies each session's custom title and archived state **only to sessions
   that still exist** on this machine; missing sessions are skipped and counted
   in the summary.
5. Reloads the app so the restored settings and layout take effect.

Restore replaces local settings rather than merging them. Session overrides are
applied where the session exists and skipped otherwise.
