# Imported monitor notification presentation

The owner reported raw Claude `<task-notification>` monitor messages in older
threads. The pinned AgentSessionImporter stores imported user-role transcript
records with createdBy=user and creationSource=server, even for provider-generated
monitor notifications. Changing only new ingestion would not fix existing history.

The managed desktop now recognizes the complete known monitor envelope only on
server-imported message IDs, without attachments. It presents those records as
collapsed Background update rows; expanding shows the event, and Original
notification exposes the exact stored text. Original text remains the copy source.
No database rewrite, provider command, notification dispatch or reimport occurs.
New web/mobile messages, guests, scheduled prompts, quoted or partial XML, unrelated
notification types and oversized/malformed records retain their existing rendering.
This is presentation inference on a legacy format, never authority to execute it.

The adapter is packaged through exact managed-desktop source/payload records, so
both the managed workspace and hosted web producer receive it. Mobile's separate
consumer graph is not changed by this PR and is not claimed as validated here.

Validation: ten focused presentation/source tests passed. Actual upstream web
and desktop TypeScript passed on the combined notification/pane source. Chromium
passed both notification cases (collapse/inspect original and new pasted XML),
alongside two pane geometry cases; the other 40 timeline cases were filtered out,
not claimed as tested. The required client CI now installs its pinned browser and
runs this regression. Local read-only dependency-cache copies needed relocation
under the owned validation node_modules for Vite's normal CommonJS optimizer;
no production dependency bytes or test assertions were changed for this.
Evidence: REL/imported-task-notifications-validation, including final-source-
verification.json (346 records, 301 final targets), type logs and browser log.
All local test processes completed. Public 0.4.2 is unchanged; a new client build
is needed to deliver this fix.

CI on 124d8ce caught two integration issues: the native-keychain QA recipe still
pinned the preceding desktop graph, and ubuntu-latest moved to 26.04, which the
frozen Playwright 1.60 browser installer rejects. The client job now uses Ubuntu
24.04 without changing dependencies or skipping browser coverage. The QA recipe
now pins the reviewed 341-record graph (3a40b8c3…). All 337 preceding records are
unchanged, the four added payloads authenticate, and none touches QA identity
targets. All seven source predecessors also match the prepared actual source.
The nine-target fixtures, strict whole-registry check and service build freeze
remain unchanged. Local evidence: ci-registry-review-imported-task-notifications.json
in the validation directory above. The historical production-predecessor-update.json
describes an earlier, separate source change and remains intact.
The corrected recipe plus all managed desktop/cloud Node suites pass: 103 tests,
zero failures or skips. The Linux browser install will be rechecked by CI; local
Chromium acceptance above remains valid because no client source changed.
