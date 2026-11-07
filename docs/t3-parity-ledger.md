# Blackcrab full parity scenario ledger

Status: NOT a certification of parity. Prepared 2026-11-07 from the pinned T3 user documentation and contracts. Reference target: [BonJenn/t3code at `7f02de2eb8e253e0ec23f005b3cfff8e2c963be8`](https://github.com/BonJenn/t3code/tree/7f02de2eb8e253e0ec23f005b3cfff8e2c963be8). Audit inventory covers every one of 47 user documents (5,775 lines), not only already shipped Blackcrab features.

The workflow descriptions and contract inventories are derived from the upstream [user documentation](https://github.com/BonJenn/t3code/tree/7f02de2eb8e253e0ec23f005b3cfff8e2c963be8/docs/user), contracts, provider drivers and MCP toolkits at that revision. This ledger summarizes acceptance obligations; upstream source and license notices remain authoritative. Blackcrab implementation evidence comes from [the delivery plan](t3-parity-plan.md) and [the iOS plan](mobile-ios-parity-plan.md), with the merge updates explicitly recorded below.

## Completion rule and status

Use this ledger per scenario: accept only evidence that demonstrates that scenario on its required surfaces, provider/account configuration and failure/recovery paths. A neighboring scenario, a merged PR, copied source or a passing test suite cannot substitute for that accepted evidence. Split grouped behaviors into independently evidenced cases before marking them complete.

`U` = absent or not verified in Blackcrab; `P` = a current plan records partial implementation evidence, not scenario completion. No scenario is marked complete in this independent inventory. Contract lists describe the target, not a claim Blackcrab implements it. Each semicolon-separated behavior below needs concrete positive, negative and recovery cases. A green build or copied backend alone does not close a row.

For every applicable scenario record: owner; implementation PR and merged stage SHA; target capability and exact versions; host OS; web/desktop/iOS surface; provider instance/account; scopes; test command/result; recorded runtime artifact; date; failure/restart evidence. Unsupported behavior is acceptable only where the pinned target itself documents that limitation, with equally clear UI. Product-owner exclusions must be explicit and remain visible as non-parity decisions.

## Universal verification gates

- G1: Independent Blackcrab host starts, authenticates and serves real operations without a running T3 host, T3 account credentials, local T3 checkout, or hidden T3 development services. Config/data separation, identifiers, public URLs, assets, shutdown/restart and signed packaging must be proven.
- G2: Desktop, hosted web and native iOS share one authoritative service/receipt/event model; cross-client read-your-writes, pagination, ordering, reconnect, duplicate delivery, uncertain command outcomes, process kill and cold restart preserve exact state.
- G3: Full/read-only/scoped/revoked/expired clients, policy ceilings, provider modes, schedules, child agents, OAuth MCP and linked environments cannot bypass permissions. Validate server enforcement, not only disabled controls.
- G4: Use each real provider/instance and source-control host in the registries below. Exercise authenticated turn, tools, approval/question where supported, stop/resume, model catalog, account switch, failure, portable handoff and restart. Fixtures supplement real execution.
- G5: Native iOS installed and signed: LAN, off-LAN/independent cloud and tailnet; foreground/background/locked/terminated; push/Live Activity; camera/photos/files/microphone; iPad/hardware keyboard/accessibility/dynamic type; upload and network loss recovery.
- G6: Desktop macOS/Windows/Linux plus hosted web: native IPC, process/filesystem/browser/keychain/terminal differences, multi-window, accessibility and packaging. Platform target limitations must be declared per feature.
- G7: Upgrade/legacy migration/backup/restore/rollback and native/mobile OTA retain account boundaries, drafts, attachments, queue state, keys and scoped pairings. Runtime mismatch fails safely.
- G8: Cloud APIs, domain/relay/tunnel/account/subscription quotas, push/APNs, widgets/extensions, crash collection, distribution signing and store review require actual independent Blackcrab configuration/deployment. Imported upstream code does not supply operational access. These are open release gates, not exclusions.

## Existing Blackcrab evidence, bounded to current plan statements

- E1: Plans record #172 provider boundary and #173 durable execution; #174–177 queues/controller/backend/desktop/mobile source. Native mobile queue QA remains open.
- E2: Plans record #178 installed Codex CLI 0.166 initialize/close, #179 fixtures, #180 routing, #181 reads, #182 history, #183 guarded controls, #184 live-client recovery, #185 preview and #187 setup entry. General Codex readiness and an actual authenticated turn remain unproven.
- E3: Plans record #188 native fixture, #189 panes, #190 switching, #193 disjoint ownership/focus, #195 retained pane recovery and #198 resizing/native four-pane/narrow/restore. Mixed-provider grids, real turns and multi-window behavior remain open.
- E4: Plans record #191 authoritative mobile host, #192 selection, #194 offline text drafts, #196 remembered startup host, #197 authenticated discovery; 109 mobile/48 protocol tests and iOS Hermes export. Installed real-device iOS, durable attachment retry, account-specific models and remote Codex actions remain open.
- E5: Architecture PR [#199](https://github.com/BonJenn/blackcrab/pull/199) merged at `e837a12e6c4738acfe8f54c82e2b1b63763ea49d`. Isolated Rust-core and T3-source startup/auth/project/restart prototypes are evidence of investigation only; this merge does not establish production host integration or all-domain parity. PRs #197 and #198 are also merged; their bounded evidence remains E4 and E3 respectively.
- E6: Packaging PR [#201](https://github.com/BonJenn/blackcrab/pull/201) merged at `b3a96405f2a48f582eaad63260b756dff129c6b2`. The relocated macOS arm64 package passed authentication, local client assets and project recovery across two starts with its fresh source unavailable and no Node/npm on its prepared PATH. This is unsigned native package evidence, not signed multi-platform distribution or provider execution evidence.
- E7: Managed desktop attachment PR [#202](https://github.com/BonJenn/blackcrab/pull/202) merged at `251f84c98a40d30fe50a297358e8afdc3519b60f`. Its native supervisor fixture authenticated after launcher exit and rejected wrong credentials/changed identity. The isolated Tauri window connected and removed its bootstrap fragment; its host remained authenticated after window/app exit. GUI relaunch observation failed (automation timeout/no exposed window), so that case remains unverified. Details and test commands are in [managed desktop workspaces](../managed-host/desktop.md); native bridge, iOS and full domain scenarios remain open.
- E8: Native managed workspace connection PR [#203](https://github.com/BonJenn/blackcrab/pull/203) merged at `3d2779d70b78db5cdf6da93d6379595a79be0ad8`. Exact shared-source onboarding/registry/RPC/shell services passed real packaged-host HTTP/WebSocket integration and iOS 26.2 simulator pairing, native catalog/cache recovery, remembered disconnect, reconnect and forget/restart checks. The simulator used isolated QA build workarounds; reproducible native distribution, physical-device/provider-turn evidence, managed agent controls and remaining mobile scenarios are open. See [the native connection increment](mobile-ios-parity-plan.md).
- Legacy Claude history/usage/backups/native terminal scaffolding are baseline functionality with runtime parity unverified. Main ledger foundation rows and full-domain work remain pending. Historical PR contents are not independently certified here; the #197–199 merge states above are supplied delivery updates rather than scenario acceptance evidence.

## Per-document scenario inventory

W = web, D = desktop, M = mobile. All rows U unless explicitly P; all applicable G1–G8 still apply. Mobile means native iOS release acceptance; Android reference behavior is inventoried separately rather than silently used as an iOS substitute.

### UD01 — `activity-log.md`

- UD01.1 U: Render grouped tools, commands, output, live tails and diffs; failed or waiting work never appears completed.
- UD01.2 U: Exercise Show / Hide successful / Hide all / Zen; questions, approvals and failures remain visible; Find reveals hidden matching intermediate activity.
- UD01.3 U: Multi-client live/reconnect transcript and long-output bounds; verify local preference persistence.
- Evidence boundary: E1/E2; this does not close the scenarios above.

### UD02 — `appearance.md`

- UD02.1 U: System/light/dark palettes, theme picker and shortcuts; create/import VS Code or T3 themes and export; per-device choices and reduced motion.
- UD02.2 U: Fonts, Markdown/code/terminal sizes, math/TeX copy, wide-formula scrolling; Android Material You and mobile layout preferences.
- UD02.3 U: Publish/set/clear/show environment theme defaults; offline first application, user overrides and invalid atomic publication fail safely.

### UD03 — `background-service.md`

- UD03.1 U: CLI up/status and service install/status/restart/uninstall, update and uninstall preserve data; exact/channel versions and downgrade protections.
- UD03.2 U: Loopback/private network binding; literal service.env and protected variables; macOS login/Linux linger; Windows service limitation shown honestly.
- UD03.3 U: Busy safe restart, diagnostics repair, doctor --fix/--dry-run, disk/in-use/offline failures; Linux OOM preview/undo and explicit legacy deletion.

### UD04 — `browser-import.md`

- UD04.1 U: Desktop one-time profile/cookie import only on explicit request; close source browser and surface keyring/permission failures.
- UD04.2 U: Safari Full Disk Access setup/reopen/revoke; Windows Firefox/Zen/Helium standard encryption paths.
- UD04.3 U: Partitioned cookies skipped; no hidden continuous sync or privileged-data leakage; verify supported platform profiles.

### UD05 — `composer.md`

- UD05.1 U: 120k character cap; 32KiB paste conversion and literal override; Markdown editor/caret/lists/code/formatting and prompt recall.
- UD05.2 U: 100-file uploads, 10MiB/image, 80MiB image aggregate, 50MiB other files; resize/HEIC/share, retry/remove/send gates; offline draft/queue attachments survive restart/sign-out.
- UD05.3 U: Queue versus Steer and opposite shortcut; edit oldest/latest queue and concurrent dequeue conflict; stopped/restarted held queues; attachment failures preserve drafts.
- Evidence boundary: E1/E2/E4; this does not close the scenarios above.
- UD05.4 U: Edit earlier prompt rewinds history with keep-files or worktree-only checkpoint restore, overlaps guarded; provider-specific rollback and current-context fallback; stash with 24h expiry and exact clipboard/citation restoration.
- UD05.5 U: /compact, /clear, /goal show/clear/pause/resume per Codex/Claude semantics; dynamic skills/commands/model/options and restart after MCP/plugins; context chips at caret and cross-environment file transfer.
- UD05.6 U: Queued edit restores prior draft; files raw/rendered/save/share/native viewers and <=50MB ZIP; media, PDF/HTML links, outside-workspace read-only HTML and no neighbor-script execution.

### UD06 — `cursor.md`

- UD06.1 U: Host official SDK runtime, Node 22.13+, paid sign-in or instance CURSOR_API_KEY; login/logout/account change stop affected runs.
- UD06.2 U: Native MCP/plugins and remote authorization, restart agent after changes; stream reasoning/tools/plans/tasks/images and interrupt/restart queued steering.
- UD06.3 U: Native child inspector read-only/nonresumable; unsupported native fork/rollback/interactive approval/active steering shown honestly; portable fork and Windows mode caveats.

### UD07 — `default-browser.md`

- UD07.1 U: macOS OS registration and default-browser selection; existing browser panel or maximized scratch browser destination.
- UD07.2 U: Special handling PR links, Finder HTML and prompt links; cold-start links queue until app ready.
- UD07.3 U: Opening external links preserves correct environment/thread identity and user confirmation boundaries.

### UD08 — `devices.md`

- UD08.1 U: Explicit support/setup/download, dependencies, boot/list/control/tab/rename/watch/poweroff; visible-only stream, floating resize/drag, 3D/fold/stance.
- UD08.2 U: Device tools drawer settings/readback/location/accessibility/permissions/push; separate agent grant/restart; HTTPS remote video versus iOS still fallback and HTTP Android limitation.
- UD08.3 U: SSH per-environment test/pinned installation/reconnect/owned cleanup; Simlock alpha gateway/token/lease/limits/return wipe/version match; missing tools fail without silent fallback.

### UD09 — `faq.md`

- UD09.1 U: Verify BYO harness/account/subscription and host-awake remote behavior; no invented local-model support or automatic account failover.
- UD09.2 U: Account cloud limits and T3 Chat linking tiers are external-service gates (3/10/100 target reference), not available merely by source reuse.
- UD09.3 U: Privacy, telemetry, worktree cleanup and host platform/provider path behavior must match actual Blackcrab deployment and documentation.

### UD10 — `guest-links.md`

- UD10.1 U: Cloud beta enable/disable; create/copy/reopen single-browser 24h link, sidebar requests, owner send/dismiss review including attachments.
- UD10.2 U: Guest timeline live tools/reasoning/questions but no privileged controls; owner permissions govern sends; archive/stop/new link/account unlink revoke.
- UD10.3 U: Four attachments, 10MB each, 20MB pending budget; unsent cleanup and sent retention; untrusted input, expiry and simultaneous owner/guest race tests.

### UD11 — `html-renders.md`

- UD11.1 U: All providers render self-contained themed sandboxed HTML on desktop/web/mobile; full screen, desktop zoom, embedded assets survive source deletion and clean with thread.
- UD11.2 U: Explicit headless Chrome download (~120MB), Linux dependencies/private-network and DNS protection; publishing does not require preview.
- UD11.3 U: Codex/Claude MCP Apps minimum support, tool/resource/message confirmations, mobile link/file prompts; persisted stopped view, live tools require running agent; navigate-away cleanup and focus escape.

### UD12 — `install.md`

- UD12.1 U: Independent Blackcrab CLI install/start/serve/up/service/update/doctor/uninstall, exact/nightly/PATH and base-dir singleton; desktop bundled CLI ownership and WSL setup.
- UD12.2 U: macOS/Windows/Linux architecture and package formats; target Intel Mac executable limitation and distro-owned updates; t3 app equivalent activation and path routing.
- UD12.3 U: iOS App Store/TestFlight and Android APK distribution, signed native crash diagnostics retention; provider install/auth/version/path and package-owner checks without silent upgrade.
- Evidence boundary: E5; this does not close the scenarios above.

### UD13 — `keybindings.md`

- UD13.1 U: Settings UI/JSON merge/last matching when clause, platform modifiers/context syntax; send/opposite/background/new thread/model/effort/permission/workspace/branch/worktree commands.
- UD13.2 U: Picker keyboard navigation/provider toggles; PR/thread copy, diff/thread find, iPad shortcuts and Return preferences; terminal keeps native shortcuts.
- UD13.3 U: Undo five seconds with input awareness; history/navigation; panel close/reopen ordering and incognito lifetime; desktop hold/double/direct quit.

### UD14 — `keyboard-focus.md`

- UD14.1 U: Command palette returns prior focus; model-number priority and async terminal creation do not steal focus.
- UD14.2 U: F6 traversal wraps visible areas and restores last focus; dialogs trap focus; settings and command palette navigation.
- UD14.3 U: Sidebar arrows/Enter/F2/context menus/groups and settings lists work with keyboard and accessibility announcements.

### UD15 — `managed-policy.md`

- UD15.1 U: Administrator per-host JSON/native profiles/registry/file show/check/templates and fingerprint; source conflicts/unknown keys fail closed, no accidental merge.
- UD15.2 U: Managed locks/defaults/inheritance/revert, max permission caps across agents/schedules, binary/env pinning; all 11 allowed-driver and account restrictions.
- UD15.3 U: Network/Tailscale/client restrictions and cleanup; connect/webhook/import/telemetry/update-feed gates; native managed OS setup and separate WSL policy, no claimed OS sandbox.

### UD16 — `mobile-notifications.md`

- UD16.1 U: Opted-in cloud-linked host publishes completion/failure/approval/input; push deep-links exact thread even without live socket.
- UD16.2 U: iOS Live Activities; Android live/ongoing updates, 15-minute and dismissal behavior; foreground alerts quiet while activity remains live.
- UD16.3 U: Permission/channels/host publish gates, locked/background/offline and other-device viewing; LAN/Tailscale alone does not enable push; Android force-quit limits explicit.
- Evidence boundary: none; this does not close the scenarios above.

### UD17 — `open-source-licenses.md`

- UD17.1 U: Desktop/web About legal listing and mobile About licenses/search show versions, components, license and full text.
- UD17.2 U: Optional device asset licenses included when shipped; MIT/upstream notices and all redistributed dependency notices retained.
- UD17.3 U: Verify packaged signed artifacts and generated notices, not only repository license files.

### UD18 — `outside-agents.md`

- UD18.1 U: Authenticated remote HTTP MCP OAuth discovery; localhost/HTTPS authentication, named client/callback approval/revoke and 30-day expiry.
- UD18.2 U: Read-only default versus supervised/full maximum across projects; real Claude/Codex/ChatGPT external clients and reachable hosted callback addresses.
- UD18.3 U: CLI thread start/send/show/list, --worktree/--wait/stdin/--json and exit 0/1/2; shared authoritative services and receipts, no parallel state writer.

### UD19 — `permission-modes.md`

- UD19.1 U: New thread/project defaults do not inherit viewed-thread mode; four modes, provider capability fallback, policy ceilings and parent/subagent approval feedback.
- UD19.2 U: Muse/Kiro two-mode limitations, fx Supervised/Auto only, Grok no auto-edit edits; Claude dangerous-removal prompts persist.
- UD19.3 U: ACP native mode versus host tool approval and Antigravity native requests; denied/read-only/revoked mobile, MCP, schedule and child paths cannot bypass caps.

### UD20 — `portable-handoffs.md`

- UD20.1 U: Provider switch/restart and fallback fork serialize selected user/assistant roles in order with current request; omit reasoning/tool state/attachments explicitly.
- UD20.2 U: Fresh-session history budget default 16k clamped 1024–64k, imported 64k bytes; reserve/image/file accounting, unknown-model fallback and no silent truncation.
- UD20.3 U: Retrieve omitted history, real provider context rejection, no-room error preserves background work; usage resets and compatible versus incompatible instances.

### UD21 — `project-settings.md`

- UD21.1 U: Environment/project/all selection, mixed values, inherited/reset/folded settings, offline failed saves; mobile filtering/rename and all-members-connected pin/archive.
- UD21.2 U: Provider enable gates new turns/queues/delegation while live turns finish; branch generation, t3.json hierarchy/submodules/setup, project icons and clean-only auto-pull.
- UD21.3 U: Schedules interval/fixed/once/timezone/new/continue/fresh/pause/run/delete; webhook signed rotate/filter/dedupe/coalesce/restart/rate/offline hold; worktree roots/dirty/ignored/live/shared cleanup reports and retention.

### UD22 — `prompt-links.md`

- UD22.1 U: Draft-only <=8000-character links; strip invisible characters with warning; repository/model routing and fallback warnings.
- UD22.2 U: Clone/setup confirmation before writing, PR worktree linking, no-project last-machine selection, OS app choice/remember.
- UD22.3 U: Existing-draft replacement confirmation, cold start, connected-only thread links and link chips; untrusted contents never auto-send.

### UD23 — `providers-acp.md`

- UD23.1 U: Registry search/platform filtering and managed exact versions/checksum when offered; local literal args no shell, v2/v1 negotiation and explicit overrides.
- UD23.2 U: Host browser/terminal auth, remote callbacks, selected auth method, shared-login logout effects; dynamic model/options/skills/commands and deduplicated session import.
- UD23.3 U: Unsupported resources/rollback/text generation/delegation clearly reflected; native versus host approval, Devin host terminal, install ownership and uninstall preserving npm/uvx.

### UD24 — `providers-antigravity.md`

- UD24.1 U: Managed runtime/helper matching version and supported platform/disk checks; Google/Enterprise/Gemini key/Vertex auth scoped to instance, no ambient credential fallback.
- UD24.2 U: Account model catalog/options and remote callback return; separate instances disable/signout/uninstall/active-stop effects and usage refresh errors.
- UD24.3 U: Native plans/compaction/rewind constraints, skill precedence, image/audio/PDF and <=20MiB MP4 Gemini on Mac/Linux; native batch children honest read-only inspector.

### UD25 — `providers-claude.md`

- UD25.1 U: Multiple accounts/config directories and compatible thread switching; credential isolation preserves HOME/system-keychain semantics; remote mobile account add uses host login.
- UD25.2 U: Router/API settings, OpenRouter separate config/empty key and actual custom-model execution; compaction 100k–1m, /compact and cache usage.
- UD25.3 U: Idle compaction three policies and missed window fallback, usage holds/reset resume; skills precedence/disabled/manual/plugin behavior and native task lists.

### UD26 — `providers-codex.md`

- UD26.1 U: Managed ChatGPT runtime/auth remote callback identity/credits/disconnect stop and retain; existing external CLI and separate shadow auth/home compatibility.
- UD26.2 U: Per-account models and actual native turns; async question continuation/dismiss survives reconnect; app access one/session/permanent approvals.
- UD26.3 U: Workspace credit/usage errors and explicit authorized /feedback upload; no fixture-only readiness claim.
- Evidence boundary: E2; this does not close the scenarios above.

### UD27 — `providers-fx.md`

- UD27.1 U: Install/path/shared CLI login and backend selector; fx status model and unsupported custom model rejection, medium effort fallback.
- UD27.2 U: Skill folder case/precedence; Supervised/Auto-only modes restart same session; steering interrupt/restart with continuation.
- UD27.3 U: Children short result versus unavailable intermediate/approval propagation; stop behavior and unsupported plan/textgen honest; fx has no usage reader.

### UD28 — `providers-kiro.md`

- UD28.1 U: CLI v3 host auth/keypath, ~/.kiro/agents custom agents (not project), catalog/effort and explicit model override.
- UD28.2 U: Supervised native approval plus end-of-turn file review versus full autopilot; whole-workspace always-allow only where supported.
- UD28.3 U: Current-step text steering versus image restart, native fork/compact and errors without silent catalog fallback; no invented usage reader.

### UD29 — `providers-muse.md`

- UD29.1 U: Host CLI login or explicit per-instance META key; ambient key ignored, status alone not proof, account instance enable/disable preserves data.
- UD29.2 U: Model/options unavailable preserves selection and fails honestly; supported Supervised/full modes; MCP failed calls continue.
- UD29.3 U: Portable fork, manual install/login/update ownership; unsupported Plan/skills menu/rewind explicit, actual authenticated run required.

### UD30 — `providers-opencode.md`

- UD30.1 U: Min 1.14.19 and 2.0.18+ compatibility, ownership-aware updates and exclusive v1/v2 DB migration; never auto-major-upgrade.
- UD30.2 U: Local managed versus external URL server/password precedence; no ambient local password leak; reconnect same session and plan agent/native compaction.
- UD30.3 U: Restricted .env approval, workspace scope and denial-not-stop; explicit refresh catalog/config/credentials with idle helper, health check does not refresh, saved model no fallback.

### UD31 — `providers-pi.md`

- UD31.1 U: 0.80.5/Node22.19 install/login/host env; literal args reject execution/session override flags and preserve explicit model/thinking selection.
- UD31.2 U: Native auth/extensions/skills/history/fork/rollback; trust notices and project-extension constraints; blocking extension dialogs and status/notification UI.
- UD31.3 U: Supervised/auto-edit/full, Auto maps Supervised; mode restart same session; durable delegation versus read-only native child; probe-failure default model honest.

### UD32 — `question-attachments.md`

- UD32.1 U: Per-question attachment drafts isolated from main composer; upload/retry/failure retention and choices-only prohibition.
- UD32.2 U: Same 100-file and file-size constraints, authenticated destination-bound upload paths.
- UD32.3 U: Reply history/revert/thread deletion cleanup and simultaneous questions across clients; no attachment cross-question contamination.

### UD33 — `remote-access.md`

- UD33.1 U: Independent cloud sign-in/link/up/connect/status scripts, JSON/non-TTY and restart; LAN/tailnet/QR one-time CA-bound pairing and learned/manual ordered routes.
- UD33.2 U: Network-change and earlier-route probes preserve host identity, per-route scopes and revocation; cloud logout removes only cloud; desktop balancing stable draft/manual/capacity and mobile manual selection.
- UD33.3 U: SSH install/reuse/forward/login PATH/owned removal; browser streams/local host ports/control/downloads/clipboard/M PiP; linked-environment beta scope intersections, delegation/results/expiry; local-host disable, deregister/quota/idle cleanup.
- Evidence boundary: E4/E5; this does not close the scenarios above.

### UD34 — `secrets.md`

- UD34.1 U: 1Password op host setup/reference field pickers; refresh rotation, failures preserve old credential and never fall back to ambient.
- UD34.2 U: Remove reference clears provider field without vault deletion; private request card accept/decline/locked/retry on all clients, no chat disclosure.
- UD34.3 U: References never reveal values to agent except explicitly disclosed private file with 24-hour cleanup; log/trace/export redaction and revoked-vault failures.

### UD35 — `snap-shot.md`

- UD35.1 U: Opted-in native Mac/Windows/Wayland (not X11) shortcut capture, current app metadata/accessibility text/icon; bounded slow fallback and persisted pending crash recovery.
- UD35.2 U: Shortcut conflicts, modifier pairs, sound/flash/reduced motion and OS permission revoke; include app text explicit.
- UD35.3 U: GNOME extension/KDE helper/Hyprland/Niri reviewed exact config backup/validate/reload and portals; unsupported setup manual and no false successful capture.

### UD36 — `source-control.md`

- UD36.1 U: All seven host brands/six drivers and enterprise/subpath endpoints; CLI minimum/auth precedence/selected host credentials, failure no alternate credential or destination.
- UD36.2 U: Turn-owned diffs/full restore, 100 commits/merge first parent/links; scratch Git identity/first commit, clone cancel/retry/SSH fallback/ghq/private publish; commit/push/PR writer styles/context.
- UD36.3 U: PR details/activities/comments/reviewers/labels/drafts/reviews/merge/automerge/revert/fork approval per-host capabilities; mobile offline uncertain writes never replay; sharing scopes/cache, guides stale matching, viewed markers, linked stacks/watch/partial merge failures.

### UD37 — `split-panes.md`

- UD37.1 U: Six desktop/web panes; existing/new thread move avoids duplicate ownership, pane focus/URL/sidebar and per-pane right panels.
- UD37.2 U: Drag swap/dividers/snapping/Alt keyboard resize/close/narrow/restart; independent mixed-provider grids.
- UD37.3 U: Desktop new-window/drag-out/menu/empty window, independent auxiliary views not persisted; browser only first window.
- Evidence boundary: E3; this does not close the scenarios above.

### UD38 — `t3-connect-troubleshooting.md`

- UD38.1 U: Four-leg device/cloud/tunnel/host diagnostics and first failure, exact identity/version/quota/expiry/clock.
- UD38.2 U: TCP/UDP port7844, direct fallback, tunnel/DNS/proxy failures and retryable versus permanent failure.
- UD38.3 U: Copy details and tunnel logs redact credentials; mobile locked/background transport and nondefault endpoints tested on independent infrastructure.

### UD39 — `telemetry.md`

- UD39.1 U: Event privacy exclusions, hashed account/install, separate server and desktop toggles; product analytics versus relay diagnostics versus web/mobile traces.
- UD39.2 U: Mobile crash report/performance ID toggle, host activity title publishing separate explicit opt-in.
- UD39.3 U: OTLP signals/endpoints/headers/protocol/env precedence, current-settings connection test/no redirect and restart; verify opt-out network capture and independent collector destination.

### UD40 — `terminal.md`

- UD40.1 U: Durable replay bounded to 5000 lines/8MiB with old-prefix eviction and complete new output; attach/reconnect/resize/close across clients.
- UD40.2 U: Navigation, selection/copy all/native shortcuts and iOS hardware keyboard behavior.
- UD40.3 U: fish --no-query-term with explicit user feature override; host process lifetime/permissions/background and restart behavior.
- Evidence boundary: legacy baseline; this does not close the scenarios above.

### UD41 — `thread-migration.md`

- UD41.1 U: T3 V1->V2 DB copy once, no live synchronization or original mutation; metadata/timeline/attachments/settings rules and independent browser profile/UI preference copy.
- UD41.2 U: Bounded import preserves unsupported history honestly; portable provider handoff and omitted history retrieval.
- UD41.3 U: Offline backups/read-only inspection/recovery copy; Blackcrab legacy Rust store migration needs its own explicit contract and rollback evidence.

### UD42 — `thread-sidebar.md`

- UD42.1 U: New thread project/environment defaults, scratch promotion/Initialize Git, recent mobile project and background multi-model worktrees; pin/reorder/cross-client order/undo drafts.
- UD42.2 U: Settled/snoozed/working shelves/grouping, title generation, search ranking/CJK, auto settle/PR merge/manual overrides and terminal settle hooks; cleanup and resume limited at reset/cancellation.
- UD42.3 U: Children/parent requests/cancel, permissioned server jobs, thread detail settings; independent side chat context and idle bring-back; custom timezone snooze returning on approval/input/failure.
- Evidence boundary: E1/E3; this does not close the scenarios above.

### UD43 — `triage.md`

- UD43.1 U: Command palette and CLI fallback target right environment/source version and perform read-only investigation.
- UD43.2 U: Ask required permission before proposed fixes or external posts; no hidden restart of current agent or host.
- UD43.3 U: Useful sanitized diagnostics and source navigation on packaged/remote hosts without assuming local source checkout.

### UD44 — `updating.md`

- UD44.1 U: App/server/provider order across all environments, busy counts/confirm/later/retry/offline skip; failed apply holds queues and old-app recovery.
- UD44.2 U: Per-host channels/compatibility/DB migration/downgrade and macOS local restriction; registry/proxy no public fallback; owner-aware provider update no active chat restart.
- UD44.3 U: Eligible active-thread continuation max three automatic retries, excludes approvals/questions/secrets/archive/snooze/settled; background work interrupted honestly, mobile OTA draft/queue persistence, protocol mismatch fail closed.

### UD45 — `usage.md`

- UD45.1 U: Eight actual usage readers aggregate histories/accounts/environments with dedupe/cache/cost/premium/other and unsupported data never estimated as fact.
- UD45.2 U: Price overrides/aliases/filter precedence and baseline-before-edit, partial mixed saves/retry only failed; subscription pools/weekly/reset/credits and unsupported custom-auth limits.
- UD45.3 U: Usage-limit cached command/details without model call; hub usage-only credentials/reset; iOS/Android offline/expired widgets, period/keyboard controls and no extra host connections.

### UD46 — `voice-input.md`

- UD46.1 U: Explicit destination, desktop host or mobile local/selected remote; model/language download/capabilities/CPU fallback same host/GPU errors/unload/live preview.
- UD46.2 U: Five-minute record/cancel/interrupt/exactly-once send/transcript insertion at selection; hold/toggle/keybindings, microphone priority/name/forget/CarPlay and browser annotation isolation.
- UD46.3 U: Language/translation/personal+project dictionary100 terms/fillers/silence; opt-in cleanup provider/context1024/raw fallback and hints; local mic/model tests, HTTPS permissions and unsupported phone behavior.

### UD47 — `welcome-wizard.md`

- UD47.1 U: Fresh install versus existing workspace/direct link/cloud entry; select multiple connected protocol-compatible hosts and preserve settings on read error.
- UD47.2 U: Provider install terminal with account-home/env isolation; Git discovery grouped recent activity, exclusions/linked worktrees/scratch/Downloads and scan-limit warnings.
- UD47.3 U: Claude/Codex/Pi native import 30 days/newest200 with ambiguity metadata, no fabricated tool/attachment history; malformed/unreadable/large files and batch100 files/4GiB/100k records, idempotence and navigation busy state.

## Additional contract-driven domains

- X01 U — **Durable orchestration:** Dispatch command IDs/receipts, transaction/outbox/event replay, immutable projection updates, bounded shell/thread snapshots, paged older history, stream gaps and resubscription; duplicate command mismatch and stale client conflict.
- X02 U — **Delegation and workflows:** Capabilities discovery, child creation/list/read/wait/interrupt, durable tasks, workflow scripts, background waits and cancellation trees; parent approvals/results; force stop versus stop workflow; cross-host links with expiry and permission intersections.
- X03 U — **Thread configuration/transfer:** Native compatible restart, portable fork, merge-back and worktree handoff/status/list; exact history import, shared-worktree ownership and live-write exclusion; title/metadata/organize/query updates.
- X04 U — **Filesystem/assets/uploads:** Read/write/search/list and shell open boundaries; path traversal/symlink/out-of-workspace enforcement; attachment prepare/upload/discard/reply/send, content-types/length/expiry and asset lifecycle; URLs authenticated to selected environment.
- X05 U — **OAuth/auth/credentials:** Discovery, pairing/session/browser session, one-time WS tickets, public-client registration/consent/code/token and DPoP/replay protection; revoke client/others/link immediately; scopes never auto-expand when owner settings change.
- X06 U — **Settings/control plane:** Nested schema defaults/migration/unknown-entry round-trip, patch atomicity/required scopes, project inheritance/reset and mixed-host partial failures; publish host status/capacity/power/background profile and enforce disable states.
- X07 U — **Maintenance/diagnostics:** Database/storage metrics, cleanup reports, backup/restore/repair/update, local process stop and host restart; logs/traces/telemetry endpoints redact sensitive data; destructive operations authorized with concrete previews.
- X08 U — **Transport subscriptions:** All RPC subscriptions: initial snapshot+live ordering, multiple environments and accounts, explicit unsubscribe/backpressure, binary stream control and expiry; no cross-client leaked data after route/account change.
- X09 U — **Native integration:** Desktop bootstrap/IPC/security boundaries, URL/app activation, install/update ownership, window state, notifications/hotkeys/screen capture; mobile secure storage, share extension, uploads, widgets, Live Activities and crash diagnostics.
- X10 U — **Independent distribution/cloud:** Blackcrab host package, protocol/version advertising, source bundle licensing/build reproducibility, signed desktop/iOS artifacts, TLS/domains/relay/push and account quota billing identity; explicit dependency/config owner and deployment evidence.

## Provider verification matrix

Every row is U for end-to-end Blackcrab parity. For each supported OS and every configured account kind, run G4 and the corresponding UD provider rows. Account-specific capabilities and unsupported modes must come from the selected instance, never a generic provider-name guess.

| Driver | Required special gates | Usage reader |
|---|---|---|
| Codex | Managed ChatGPT + external CLI; shadow auth/home compatibility; app approvals and async questions | yes |
| Claude / claudeAgent | CLI/subscription/API/router, config directory isolation, skills/tasks/compaction/limits | yes |
| Cursor | Official SDK auth/key, Node requirement, native task/approval/Windows limits | yes |
| Grok | Registry capability/account/catalog; no auto-edit support; real turns and explicit unsupported modes | yes |
| fx | Shared CLI login, Supervised/Auto only, short native children | no |
| OpenCode | Local/external server, passwords, v1/v2 exclusive migrations, plan/approvals | yes |
| Antigravity | Google/Enterprise/Gemini/Vertex, helper version/skill and media constraints | yes |
| Kiro | CLI v3, user agents, native file reviews/permission choices | no |
| Pi | Native login/extensions/dialogs/trust and supported mode mapping | yes |
| Muse | Shared login or explicit instance key, supported modes/catalog errors | yes |
| ACP registry | Each selected registry/local agent version/auth method/platform, protocol negotiation and dynamic capability limits | no general reader |

Registry source: `apps/server/src/provider/builtInDrivers.ts`: 11 built-in drivers, eight usage readers. ACP is a driver of potentially many agents, so testing one ACP agent does not certify the registry. Grok has no dedicated user document and is nevertheless required by the driver registry.

## Source-control verification matrix

| Host brand(s) | Required independent integration coverage | Status |
|---|---|---|
| GitHub | github.com + configured enterprise endpoint, gh auth/account, PR reviews/actions/automerge/fork checks/revert/stacks | U |
| GitLab | configured SaaS/self-host, glab auth/project routing, supported review/merge/automerge | U |
| GitCafe | configured host/CAFE_HOST, CLI auth/account and host capability differences | U |
| Forgejo / Gitea | both brands, fj/tea selection, custom base URL/subpath, CLI minimum and capability differences | U |
| Bitbucket | selected host/workspace, token scopes, PR branch/merge/comment limits | U |
| Azure DevOps | organization/project endpoint, CLI/token/account, supported review/automerge | U |

Source: `apps/server/src/sourceControl/sourceControlDefinitions.ts`: six drivers, seven host brands. Run clone/commit/push/publish/create/read/comment/review/merge/watch/unwatch where advertised; denied permissions, unknown write result, stale credentials, offline cache and wrong-host protections for each. Never extrapolate GitHub success to other hosts.

## Exact target RPC inventory

190 general WS declarations (`rpc.ts`) plus 21 orchestration WS declarations (`orchestrationV2.ts`), 211 total. Each method requires input validation, scope enforcement, success, error/unsupported behavior and retry/reconnect tests; mutations additionally require receipt/idempotency and uncertain-result tests. Subscription lifetime tests are separate from initial reads. All are U until an implementation/evidence link closes them.

### General

- **projects (10):** `projects.listEntries`, `projects.listIgnoredFiles`, `projects.readFile`, `projects.searchContents`, `projects.searchEntries`, `projects.writeFile`, `projects.mutate`, `projects.ensureScratch`, `projects.createNew`, `projects.createFromThread`
- **shell (1):** `shell.openInEditor`
- **filesystem (2):** `filesystem.browse`, `filesystem.getMetadata`
- **agentSessions (2):** `agentSessions.scan`, `agentSessions.import`
- **assets (2):** `assets.createUrl`, `assets.persistChatAttachments`
- **attachments (2):** `attachments.createUploadUrl`, `attachments.delete`
- **mcpApps (4):** `mcpApps.callTool`, `mcpApps.toolInfo`, `mcpApps.readResource`, `mcpApps.updateModelContext`
- **provider (15):** `provider.uploadFeedback`, `provider.auth.start`, `provider.consumeResetCredit`, `provider.auth.complete`, `provider.chatgpt.reconnect-profile`, `provider.chatgpt.import-profile`, `provider.chatgpt.handoff.subscribe`, `provider.auth.respond`, `provider.auth.cancel`, `provider.auth.logout`, `provider.auth.subscribe`, `provider.install.start`, `provider.install.cancel`, `provider.install.subscribe`, `provider.install.remove`
- **vcs (8):** `vcs.pull`, `vcs.refreshStatus`, `vcs.listRefs`, `vcs.createWorktree`, `vcs.removeWorktree`, `vcs.createRef`, `vcs.switchRef`, `vcs.init`
- **git (3):** `git.runStackedAction`, `git.resolvePullRequest`, `git.preparePullRequestThread`
- **review (3):** `review.getBranchCommits`, `review.getDiffPreview`, `review.getDiffFileContents`
- **terminal (7):** `terminal.open`, `terminal.attach`, `terminal.observe`, `terminal.write`, `terminal.resize`, `terminal.clear`, `terminal.close`
- **preview (9):** `preview.open`, `preview.resize`, `preview.adjust`, `preview.close`, `preview.list`, `preview.clearProfile`, `preview.reportProfiles`, `preview.reportStatus`, `preview.stopLocalServer`
- **device (10):** `device.configure`, `device.list`, `device.testHost`, `device.easAccount`, `device.simlockIdentity`, `device.open`, `device.close`, `device.shutdown`, `device.detail`, `device.action`
- **server (38):** `server.probe`, `server.getConfig`, `server.getNpmRelease`, `server.refreshProviders`, `server.updateProvider`, `server.updateServer`, `server.updateServerWithProgress`, `server.commitDesktopUpdate`, `server.upsertKeybinding`, `server.removeKeybinding`, `server.runStorageCleanup`, `server.getStorageCleanupReport`, `server.getDatabaseStorage`, `server.updateSettings`, `server.discoverSourceControl`, `server.searchAcpRegistry`, `server.prepareAcpRegistryAgent`, `server.uninstallAcpRegistryManagedBinary`, `server.acceptAcpRegistryUrlAuth`, `server.listAcpRegistrySessions`, `server.importAcpRegistrySession`, `server.deleteAcpRegistrySession`, `server.listAcpRegistryProviders`, `server.setAcpRegistryProvider`, `server.disableAcpRegistryProvider`, `server.logoutAcpRegistry`, `server.getTraceDiagnostics`, `server.getProcessDiagnostics`, `server.getHostResources`, `server.getProcessResourceHistory`, `server.getResourceTelemetryHistory`, `server.retryResourceTelemetry`, `server.checkOtlpEndpoint`, `server.prepareTriage`, `server.signalProcess`, `server.reportClientActivity`, `server.getUsageSummary`, `server.refreshUsageRates`
- **peerLinks (4):** `peerLinks.list`, `peerLinks.link`, `peerLinks.unlink`, `peerLinks.answerRequest`
- **scheduledTasks (8):** `scheduledTasks.subscribe`, `scheduledTasks.upsert`, `scheduledTasks.setEnabled`, `scheduledTasks.delete`, `scheduledTasks.runNow`, `scheduledTasks.rotateWebhookToken`, `scheduledTasks.listWebhookDeliveries`, `scheduledTasks.getWebhookDelivery`
- **secrets (1):** `secrets.answerRequest`
- **guestShare (1):** `guestShare.create`
- **cloud (2):** `cloud.getRelayClientStatus`, `cloud.installRelayClient`
- **pullRequests (34):** `pullRequests.list`, `pullRequests.listStats`, `pullRequests.filterOptions`, `pullRequests.summary`, `pullRequests.routing`, `pullRequests.routingIdentity`, `pullRequests.stack`, `pullRequests.linkedThreads`, `pullRequests.detail`, `pullRequests.preview`, `pullRequests.checks`, `pullRequests.activity`, `pullRequests.reviewGuide`, `pullRequests.generateReviewGuide`, `pullRequests.threadComments`, `pullRequests.diffFileContents`, `pullRequests.filesViewed`, `pullRequests.changeBreakdown`, `pullRequests.setFilesViewed`, `pullRequests.runAction`, `pullRequests.update`, `pullRequests.comment`, `pullRequests.updateComment`, `pullRequests.submitReview`, `pullRequests.replyToThread`, `pullRequests.setThreadResolution`, `pullRequests.setReaction`, `pullRequests.invalidate`, `pullRequests.reportState`, `pullRequests.subscribeRefreshes`, `pullRequests.reviewerCandidates`, `pullRequests.requestReviewers`, `pullRequests.labelCandidates`, `pullRequests.setLabels`
- **sourceControl (9):** `sourceControl.lookupRepository`, `sourceControl.cloneRepository`, `sourceControl.publishRepository`, `sourceControl.signInStart`, `sourceControl.signInWait`, `sourceControl.signInCancel`, `sourceControl.appAccess`, `sourceControl.starred`, `sourceControl.star`
- **projectClone (3):** `projectClone.start`, `projectClone.cancel`, `projectClone.retry`
- **subscribeProjectClones (1):** `subscribeProjectClones`
- **subscribeVcsStatus (1):** `subscribeVcsStatus`
- **subscribeWorktreeSetup (1):** `subscribeWorktreeSetup`
- **worktreeSetup (1):** `worktreeSetup.cancel`
- **subscribeTerminalMetadata (1):** `subscribeTerminalMetadata`
- **subscribePreviewEvents (1):** `subscribePreviewEvents`
- **subscribeDiscoveredLocalServers (1):** `subscribeDiscoveredLocalServers`
- **subscribeDeviceState (1):** `subscribeDeviceState`
- **subscribeServerConfig (1):** `subscribeServerConfig`
- **subscribeServerLifecycle (1):** `subscribeServerLifecycle`
- **subscribeAuthAccess (1):** `subscribeAuthAccess`
- **subscribeResourceTelemetry (1):** `subscribeResourceTelemetry`
### Orchestration

- **orchestration (21):** `orchestration.dispatchCommand`, `orchestration.getTurnDiff`, `orchestration.getFullThreadDiff`, `orchestration.searchThreads`, `orchestration.searchThread`, `orchestration.searchThreadStream`, `orchestration.getArchivedShellSnapshot`, `orchestration.getThreadFamily`, `orchestration.getThreadTitles`, `orchestration.getWorktreeThreadIds`, `orchestration.getOlderSettledThreads`, `orchestration.getThreadProjection`, `orchestration.getWorkflowScript`, `orchestration.getNativeChildWork`, `orchestration.stopWorkflow`, `orchestration.forceStopThread`, `orchestration.getTurnItem`, `orchestration.launchThread`, `orchestration.subscribeShell`, `orchestration.subscribeThread`, `orchestration.subscribeCommandOutput`

## Exact MCP toolkit declaration inventory

71 named toolkit declarations in `apps/server/src/mcp/toolkits/**/tools.ts` (70 literal names plus `HTML_RENDER_TOOL_NAME = html_render`). This is the scoped toolkit declaration inventory, not a claim every possible dynamic/provider tool has been enumerated. Each must have discovery/schema parity, capability-conditioned availability, read-only denial, exact selected host/thread routing, cancellation and actual service-effect tests. OAuth client visibility and in-agent visibility require separate tests.

- **attachment:** `t3_attachment_prepare_upload`, `t3_attachment_discard`, `t3_thread_send_attachments`
- **device:** `device_list`, `device_open`, `device_screenshot`, `device_close`
- **environment:** `t3_environment_read`, `t3_environment_preferences_update`
- **html:** `html_preview`, `html_render`
- **orchestrator:** `orchestrator_capabilities`, `delegate_task`, `task_status`, `task_cancel`, `t3_workflow_stop`, `t3_background_wait`, `schedule_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `request_secret`, `create_threads`, `t3_thread_list`, `t3_thread_read`, `t3_thread_update`, `t3_thread_send`, `t3_thread_wait`, `t3_thread_interrupt`, `t3_environment_links`, `t3_environment_link`, `t3_environment_unlink`
- **preview:** `preview_status`, `preview_open`, `preview_dialog`, `preview_navigate`, `preview_resize`, `preview_set_appearance`, `preview_snapshot`, `preview_act`, `preview_evaluate`, `preview_wait_for`, `preview_recording_start`, `preview_recording_stop`
- **previewControls:** `t3_preview_list`, `t3_preview_close`
- **project:** `t3_project_list`, `t3_project_read`, `t3_project_create`, `t3_project_update`, `t3_project_delete`, `t3_project_clone`, `t3_thread_launch`
- **pullRequests:** `link_pull_request`, `link_pull_requests`, `unlink_pull_request`, `unlink_pull_requests`, `list_thread_pull_requests`, `watch_pull_request`, `unwatch_pull_request`, `write_pull_request_guides`, `read_pull_request_guide`
- **thread:** `t3_thread_organize`, `t3_queue`, `t3_pending_request`, `t3_thread_configure`, `t3_thread_transfer`, `t3_thread_search`, `run_scheduled_task_now`
- **worktree:** `t3_worktree_handoff`, `t3_worktree_status`, `t3_worktree_list`

## Target HTTP declaration inventory

49 declarations from `environmentHttp.ts` (including four symbolic webhook routes resolved below). These require authenticated route, cache/content-type, origin/CSRF where relevant, replay, validation and permission evidence; HTTP reads must agree with WS projections.

- U `GET /.well-known/t3/environment` (`descriptor`)
- U `GET /api/auth/session` (`session`)
- U `POST /api/auth/browser-session` (`browserSession`)
- U `POST /oauth/token` (`token`)
- U `POST /api/auth/websocket-ticket` (`webSocketTicket`)
- U `POST /api/auth/websocket-ticket/:use` (`webSocketTicketFor`)
- U `POST /api/auth/pairing-token` (`pairingCredential`)
- U `POST /api/auth/pairing-links/revoke` (`revokePairingLink`)
- U `POST /api/auth/clients/revoke` (`revokeClient`)
- U `POST /api/auth/clients/revoke-others` (`revokeOtherClients`)
- U `GET /.well-known/oauth-protected-resource` (`protectedResource`)
- U `GET /.well-known/oauth-protected-resource/mcp` (`mcpProtectedResource`)
- U `GET /.well-known/oauth-authorization-server` (`authorizationServer`)
- U `POST /oauth/mcp/register` (`register`)
- U `GET /oauth/mcp/authorize` (`authorize`)
- U `POST /oauth/mcp/approval` (`approval`)
- U `POST /oauth/mcp/decision` (`decision`)
- U `POST /oauth/mcp/token` (`token`)
- U `GET /api/orchestration/shell` (`shellSnapshot`)
- U `GET /api/orchestration/threads/:threadId` (`threadSnapshot`)
- U `GET /api/orchestration/threads/:threadId/transcript` (`threadTranscript`)
- U `GET /api/orchestration/threads/:threadId/bounded` (`threadBoundedSnapshot`)
- U `GET /api/orchestration/threads/:threadId/history` (`threadHistoryPage`)
- U `GET /api/projects` (`snapshot`)
- U `POST /api/projects/mutate` (`mutate`)
- U `POST /api/pull-requests/diff` (`diff`)
- U `GET /api/voice/status` (`status`)
- U `POST /api/voice/models/prepare` (`prepareModel`)
- U `GET /api/voice/models` (`models`)
- U `POST /api/voice/models/download` (`downloadModel`)
- U `POST /api/voice/models/select` (`selectModel`)
- U `POST /api/voice/models/cancel` (`cancelModelDownload`)
- U `POST /api/voice/models/remove` (`removeModel`)
- U `POST /api/voice/acceleration` (`updateAcceleration`)
- U `POST /api/voice/model-unload-timeout` (`updateModelUnloadTimeout`)
- U `POST /api/voice/transcribe` (`transcribe`)
- U `POST /api/voice/post-process` (`postProcess`)
- U `POST /api/connect/link-proof` (`linkProof`)
- U `POST /api/connect/relay-config` (`relayConfig`)
- U `GET /api/connect/link-state` (`linkState`)
- U `POST /api/connect/reachability` (`checkReachability`)
- U `POST /api/connect/unlink` (`unlink`)
- U `POST /api/connect/preferences` (`preferences`)
- U `POST /api/t3-connect/health` (`health`)
- U `POST /api/t3-connect/mint-credential` (`t3MintCredential`)
- U `POST /api/hooks/:hookId/:token` (`webhookPost`)
- U `PUT /api/hooks/:hookId/:token` (`webhookPut`)
- U `PATCH /api/hooks/:hookId/:token` (`webhookPatch`)
- U `GET /api/hooks/:hookId/:token` (`webhookGet`)

## Public orchestration command discriminants

56 discriminants from the public command union; every variant needs field-level/permission/receipt/persistence coverage. These are behavior variants behind RPC dispatch, not additional RPC method counts.

`thread.stop`, `thread.create`, `thread.archive`, `thread.guest-share.close`, `thread.guest-message.dismiss`, `thread.unarchive`, `thread.delete`, `thread.settle`, `thread.auto-settle`, `thread.unsettle`, `thread.snooze`, `thread.unsnooze`, `thread.auto-settle.set`, `thread.pin`, `thread.unpin`, `thread.tag.set`, `thread.pin.reorder`, `thread.active.reorder`, `thread.visit`, `thread.mark-unread`, `thread.metadata.update`, `thread.pull-request.link`, `thread.pull-request.unlink`, `thread.pull-request-link.sync`, `thread.pull-request.watch`, `thread.pull-request.sync`, `thread.title.regeneration.complete`, `thread.runtime-mode.set`, `thread.interaction-mode.set`, `thread.model-selection.set`, `provider-session.detach`, `message.dispatch`, `prepared-run.release`, `notification.delivery.accept`, `prepared-run.progress`, `prepared-run.fail`, `prepared-run.retry`, `subagent.stop`, `run.interrupt`, `queued-message.promote-to-steer`, `queue.resume`, `queued-run.start`, `queued-run.reorder`, `queued-run.cancel`, `queued-run.edit`, `runtime-request.respond`, `thread.user-input.dismiss`, `checkpoint.rollback`, `thread.fork`, `thread.merge_back`, `delegated_task.request`, `delegated_task.wake-policy`, `delegated_task.completion-delivery.acknowledge`, `delegated_task.completion-delivery.dispose`, `thread.created.record`, `provider.switch`

## Settings inventories and persistence matrix

All keys below are U for full Blackcrab round-trip/behavior parity. For each test defaults, edit/reset, validation, restart, scope denial, client-vs-host storage, account/host switching, mixed multi-host partial saves and legacy migration. Enumerated top-level keys do not close nested provider/device/auth/observability structures: recursively enumerate nested fields during implementation. Project-scoped values require inheritance and folded/mixed presentation; device settings must not accidentally synchronize as host settings.

### Server settings (77)

`favorites`, `providerModelPreferences`, `worktreeCleanup`, `storageCleanup`, `worktreesDirectory`, `previousWorktreesDirectories`, `responseStreamingMode`, `enableProviderUpdateChecks`, `continueThreadsAfterServerUpdate`, `enableAgentBrowserAccess`, `speechModelId`, `speechAcceleration`, `speechModelUnloadTimeout`, `speechProjectCustomWords`, `speechPostProcessingModelSelection`, `projectAgentBrowserAccessOverrides`, `defaultAutoPull`, `defaultProjectScripts`, `projectScriptOverrides`, `projectAutoPullOverrides`, `defaultModelSelection`, `fallbackModelSelection`, `defaultRuntimeMode`, `projectSettingsOverrides`, `projectSettingsFolded`, `enableAgentDeviceAccess`, `enableDeviceSupport`, `deviceOnboardingCompleted`, `deviceHosts`, `easDeviceHosts`, `simlockDeviceHosts`, `simlockDeviceHostsEnabled`, `sidebarAutoSettleAfterDays`, `compactIdleThreads`, `idleCompaction`, `snoozeLimitedThreads`, `autoResumeLimitedThreads`, `snoozePresets`, `hiddenThreadTags`, `hideTaggedThreads`, `guestSharingEnabled`, `linkedEnvironmentsEnabled`, `sidebarAutoSettleKeepPullRequests`, `sidebarAutoSettleOnMerge`, `backgroundActivity`, `automaticGitFetchInterval`, `providerHealthRefreshInterval`, `backgroundActivityProfile`, `defaultTheme`, `defaultThemeSetAt`, `environmentIcon`, `defaultThreadEnvMode`, `newWorktreesStartFromOrigin`, `worktreeSubmodules`, `addProjectBaseDirectory`, `ghqCloneLayout`, `textGenerationModelSelection`, `threadTitleInstructions`, `branchNamingMode`, `branchNamePrefix`, `branchNameInstructions`, `removeAgentCreditsOnMerge`, `sourceControlWritingStyle`, `sourceControlWriterModelSelection`, `reviewGuidesEnabled`, `reviewGuideModelSelection`, `reviewGuideInstructions`, `pullRequestMergeMethod`, `providerInstances`, `observability`, `sourceControlHosts`, `usageLimitSources`, `secretProviders`, `cursorKeychainUsageEnabled`, `usagePriceOverrides`, `usageModelAliases`, `usageModelFilter`

### Project-scoped server keys (27)

`worktreeCleanup`, `defaultModelSelection`, `defaultRuntimeMode`, `defaultThreadEnvMode`, `newWorktreesStartFromOrigin`, `worktreeSubmodules`, `defaultAutoPull`, `defaultProjectScripts`, `enableAgentBrowserAccess`, `enableAgentDeviceAccess`, `textGenerationModelSelection`, `threadTitleInstructions`, `sourceControlWriterModelSelection`, `reviewGuideModelSelection`, `reviewGuideInstructions`, `sourceControlWritingStyle`, `removeAgentCreditsOnMerge`, `branchNamingMode`, `branchNamePrefix`, `branchNameInstructions`, `pullRequestMergeMethod`, `sidebarAutoSettleOnMerge`, `sidebarAutoSettleAfterDays`, `sidebarAutoSettleKeepPullRequests`, `continueThreadsAfterServerUpdate`, `responseStreamingMode`, `speechProjectCustomWords`

### Web/desktop client settings (82)

`notificationMode`, `inAppNotificationsEnabled`, `diffColorScheme`, `chatWidth`, `effortDisplay`, `loadBalancingEnabled`, `loadBalancingWeights`, `appearanceContrast`, `panelAnimationDurationMs`, `browserDefaultViewport`, `browserDefaultZoomFactor`, `browserDefaultAppearance`, `browserRecordingFrameRate`, `browserRecordingShowKeyPresses`, `browserRecordingShowMousePresses`, `browserLinkTarget`, `browserSearchEngine`, `browserCustomSearchUrl`, `browserAutoShowFloatingPreview`, `browserProfiles`, `browserDefaultProfileId`, `confirmQuit`, `confirmThreadArchive`, `confirmThreadDelete`, `confirmThreadUnpin`, `diffFilesCollapsed`, `diffIgnoreWhitespace`, `diffLayout`, `environmentIdentificationMode`, `glassOpacity`, `fontSizeInterface`, `fontSizePrompt`, `fontSizeCode`, `fontSizeTerminal`, `fontFamilyCode`, `fontFamilyComposer`, `fontFamilySans`, `fontFamilyTerminal`, `fontSmoothing`, `onboardingCompletedAt`, `persistComposerContextStrip`, `favorites`, `providerModelPreferences`, `pullRequestMergeMethodOverrides`, `pullRequestLinksOpenInApp`, `planModeEnabled`, `contextWindowMeterEnabled`, `composerRichTextEnabled`, `sendShortcut`, `followUpBehavior`, `proactivePanelsEnabled`, `showSkillsInSlashMenu`, `boringSidebarEnabled`, `boringSidebarMultilineRows`, `toolCallVisibility`, `threadDetailsUsageEnabled`, `threadDetailsItems`, `legacySidebarEnabled`, `sidebarWorkingShelfEnabled`, `sidebarProjectGroupingMode`, `sidebarProjectGroupingOverrides`, `sidebarProjectSortOrder`, `sidebarThreadSortOrder`, `timestampFormat`, `voiceMicrophone`, `voiceShortcutMode`, `speechLanguage`, `speechTranslateToEnglish`, `speechCustomWords`, `speechSilenceFiltering`, `speechRemoveFillerWords`, `speechPostProcessingPrompt`, `speechCorrectionWord`, `snapShotEnabled`, `snapShotIncludeAccessibility`, `snapShotShortcut`, `snapShotPlaySound`, `snapShotSound`, `snapShotFlash`, `snapShotAnimations`, `wordWrap`, `mathRenderingEnabled`

### Native mobile preferences (37)

`navigationTabOrder`, `hiddenNavigationTabs`, `pullRequestHideTestFiles`, `pullRequestMergeMethod`, `liveActivitiesEnabled`, `themeId`, `lightThemeId`, `darkThemeId`, `themeMode`, `androidNavigationStyle`, `baseFontSize`, `terminalFontSize`, `markdownFontSize`, `codeFontSize`, `codeWordBreak`, `mathRenderingEnabled`, `crashReportsEnabled`, `connectOnboardingOptOutAccounts`, `collapsedProjectGroups`, `dismissedDatabaseStorageNotices`, `composerEnterBehavior`, `followUpBehavior`, `microphones`, `projectGroupingEnabled`, `projectGroupingMode`, `planModeEnabled`, `toolCallVisibility`, `workingShelfEnabled`, `useLastProjectForNewThreads`, `lastThreadProject`, `modelFavorites`, `threadListSettledShelfExpanded`, `threadListSnoozedShelfExpanded`, `threadListWorkingShelfExpanded`, `threadListFilters`, `pullRequestListFilters`, `workspaceSelections`

The mobile interface also contains nested filter, microphone, favorite and workspace selection payloads. Runtime-specific persistence keys outside these primary schemas require a follow-up completeness search (onboarding flags, caches, draft stores, widget shared stores and secure storage). This is an explicit inventory gap, not excluded scope.

## Auth scope obligations

`orchestration:read`, `orchestration:operate`, `settings:write`, `providers:manage`, `environment:maintain`, `preview:operate`, `diagnostics:read`, `terminal:read`, `terminal:operate`, `source-control:write`, `filesystem:read`, `filesystem:write`, `review:write`, `access:read`, `access:write`, `relay:read`, `relay:write`

`review:write` is legacy and must not be mistaken for a current effective grant. Use server-authoritative mappings and input-dependent required scopes (PR creation/worktree actions/settings patches), not only the client method map. Verify read-only clients can consume authorized data while every mutation path, OAuth MCP tool and stream remains appropriately restricted.

## Explicit release gates and open inventory work

- Not excluded: independent host/service installers, production embedded/shared runtime integration, legacy data migration, all 11 provider drivers and ACP agents, all seven source-host brands, full desktop windows, native real-device iOS and cloud operation.
- Not excluded: iOS signing, provisioning/APNs, Live Activity and widget extensions, background delivery, share/files/microphone permissions, App Store/TestFlight distribution and privacy declarations. An Expo/Hermes export is build evidence only.
- Not excluded: independent hosted web, identity/quota/billing/tunnel/relay endpoints, OAuth redirect registrations, TLS, 1Password/operator setup, provider logins, OS permissions and device farm/SSH credentials. Required secrets or paid services need an owner and reproducible setup; unavailable configuration remains blocked, never silently “not applicable.”
- Target-supported limitations stay explicit: browser-only features, Android-only Material You/live updates, macOS-only default browser, no X11 Snap Shot, Windows background-service/device constraints, beta features and provider unsupported capabilities. Android release parity is a separate product/platform decision; its reference behavior remains inventoried while the requested release target is iOS.
- Open completeness tasks: recursively inventory nested contract settings/provider schemas, dynamic registry tools and installed ACP catalog, native IPC endpoints, HTTP routes outside environmentHttp.ts, background/cloud worker APIs and additional secure/cache/widget persistence stores. The exact appendices above are scoped declarations and do not pretend to close these searches.

## Audit counts and acceptance sequence

- 47/47 pinned user documents read; 144 numbered document scenario groups (three per document plus three extra composer groups), each containing several atomic behaviors; ten additional contract-domain groups.
- 190 general + 21 orchestration WS method declarations; 71 MCP toolkit declarations; 49 HTTP declarations; 56 public orchestration discriminants.
- 77 server setting keys, 27 project-scoped keys, 82 client-setting keys and 37 mobile-preference keys; 11 provider drivers/eight usage readers; six source-control drivers/seven host brands.
- Zero scenario groups certified complete by this independent audit. Partial historical evidence is bounded in E1–E5 and must be linked to actual scenario-specific runtime proof before promotion.

Acceptance order: integrate independent authoritative host and migration; close command/auth/event invariants; implement client surfaces/provider/source-control adapters in reviewable PRs; run each scenario on its supported surfaces and real accounts; complete signed distribution and independent cloud/device gates; audit every remaining U/P row and intentional target limitation against the pinned reference. Merge-to-stage is implementation progress, not the final parity certificate.
