"""Record reviewed literal edits against a freshly prepared production desktop source."""
import sys, pathlib, json, hashlib, difflib
root=pathlib.Path(sys.argv[1]); here=pathlib.Path(__file__).parent
sha=lambda b:hashlib.sha256(b).hexdigest()
records=[]
def patch(id,target,replacements):
    before=(root/target).read_text(); after=before
    for a,b in replacements:
        if after.count(a)!=1: raise ValueError((id,a[:100],after.count(a)))
        after=after.replace(a,b)
    diff=''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+target,tofile='b/'+target))
    file='patches/'+id+'.patch'; (here/file).write_text(diff)
    records.append(dict(id=id,target=target,file=file,sha256=sha(diff.encode()),beforeSha256=sha(before.encode()),afterSha256=sha(after.encode()),replacements=[dict(before=a,after=b) for a,b in replacements]))
def payload(file,target):
    b=(here/'payloads'/file).read_bytes()
    records.append(dict(id='ide-'+file.replace('.','-'),target=target,kind='payload',file='payloads/'+file,sha256=sha(b),beforeSha256=None,afterSha256=sha(b)))
patch('ide-contract','packages/contracts/src/project.ts',[
 ('export const ProjectReadFileInput = Schema.Struct({', 'export const ProjectReadFileInput = Schema.Struct({\n  ideGuardedRead: Schema.optional(Schema.Boolean),'),
 ('  // Omitted by older servers; false only for an absent optional file.', '  ideSafeWrite: Schema.optional(Schema.Boolean),\n  // Omitted by older servers; false only for an absent optional file.'),
 ('export const ProjectWriteFileInput = Schema.Struct({\n  cwd: TrimmedNonEmptyString,','export const ProjectWriteFileInput = Schema.Struct({\n  ideExpectedContents: Schema.optional(Schema.String),\n  cwd: TrimmedNonEmptyString,'),
 ('export const ProjectWriteFileResult = Schema.Struct({\n  relativePath: TrimmedNonEmptyString,','export const ProjectWriteFileResult = Schema.Struct({\n  ideConflict: Schema.optional(Schema.Boolean),\n  ideRecoveryPath: Schema.optional(Schema.String),\n  relativePath: TrimmedNonEmptyString,')])
patch('ide-host','apps/server/src/workspace/WorkspaceFileSystem.ts',[
 ('import * as NodeFSP from "node:fs/promises";', 'import * as NodeFSP from "node:fs/promises";\nimport { ideWriteFile } from "./ideGuardedWrite.ts";'),
 ('            byteLength: stat.size,\n            truncated,','            byteLength: stat.size,\n            ...(input.ideGuardedRead ? { ideSafeWrite: true } : {}),\n            truncated,'),
 ('    yield* Effect.tryPromise({\n      // A symlink swapped in after the check is not followed. Windows lacks O_NOFOLLOW.\n      try: () =>\n        NodeFSP.writeFile(realTargetPath, input.contents, {\n          flag:\n            NodeFS.constants.O_WRONLY |\n            NodeFS.constants.O_CREAT |\n            NodeFS.constants.O_TRUNC |\n            (NodeFS.constants.O_NOFOLLOW ?? 0),\n        }),',
  '    const ideResult = yield* Effect.tryPromise({\n      try: () => ideWriteFile(realTargetPath, input.contents, input.ideExpectedContents),'),
 ('    return { relativePath: target.relativePath };','    return { relativePath: target.relativePath, ideConflict: ideResult.conflict, ideRecoveryPath: ideResult.recoveryPath };')])
patch('ide-editor-helper','apps/web/src/components/files/FilePreviewPanel.tsx',[
 ('function useEditableAfterHighlight(file: FileContents)', 'export function useEditableAfterHighlight(file: FileContents)')])
patch('ide-chat','apps/web/src/components/ChatView.tsx',[
 ('import { workspaceAreaProps }', 'import IdePanel from "./ide/IdePanel";\nimport { workspaceAreaProps }'),
 ('  const [workspaceLayoutElement, setWorkspaceLayoutElement]', '  const [ideMode, setIdeMode] = useState(false);\n  const ideEnabled = import.meta.env.VITE_BLACKCRAB_IDE_MODE === "1" && !embedded;\n  const [workspaceLayoutElement, setWorkspaceLayoutElement]'),
 ('            {pane ? <PaneHeaderControls', '            {ideEnabled ? <button type="button" className="shrink-0 rounded border px-2 py-1 text-xs [-webkit-app-region:no-drag]" aria-pressed={ideMode} onClick={() => setIdeMode(!ideMode)}>{ideMode ? "Chat mode" : "IDE mode"}</button> : null}\n            {pane ? <PaneHeaderControls'),
 ('        <div className="relative flex min-h-0 min-w-0 flex-1">\n          <ThreadFindCanvas', '        <div className="relative flex min-h-0 min-w-0 flex-1">\n          {ideEnabled && ideMode && activeWorkspaceRoot ? <IdePanel key={`${activeThreadKey}:${environmentId}:${activeWorkspaceRoot}`} environmentId={environmentId} cwd={activeWorkspaceRoot} projectName={activeProject?.title ?? "Workspace"} composerDraftTarget={composerDraftTarget} items={serverVisibleTurnItems} workspaceMutationId={workspaceMutationId} /> : null}\n          <ThreadFindCanvas')])
for file in ['IdePanel.tsx','ideState.ts','ide-mode.css','IdePanel.browser.test.tsx','IdeCodeEditor.browser.test.tsx']:
    payload(file,'apps/web/src/components/ide/'+file)
payload('ideGuardedWrite.ts','apps/server/src/workspace/ideGuardedWrite.ts')
payload('IdeWorkspaceFileSystem.test.ts','apps/server/src/workspace/IdeWorkspaceFileSystem.test.ts')
(here/'registry.json').write_text(json.dumps(records,indent=2)+'\n')
