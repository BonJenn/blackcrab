import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import IdePanel from "./IdePanel";

const host = vi.hoisted(() => ({ files: { "a.ts": "first", "b.ts": "second" } as Record<string,string>, writes: [] as unknown[], comments: [] as unknown[], safe: true }));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => async ({ input }: {input:{relativePath:string}}) => ({ _tag: "Success", value: { contents: host.files[input.relativePath], truncated: false, ideSafeWrite: host.safe } }) }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => async ({input}: {input:{relativePath:string;contents:string;ideExpectedContents:string}}) => {
  host.writes.push(input);
  if (host.files[input.relativePath] !== input.ideExpectedContents) return { _tag: "Success", value: { ideConflict: true } };
  host.files[input.relativePath] = input.contents;
  return { _tag: "Success", value: { ideConflict: false, ideRecoveryPath: "/fixture/recovery.bak" } };
} }));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("~/state/projects", () => ({ projectEnvironment: {} }));
vi.mock("~/composerDraftStore", () => ({ useComposerDraftStore: (select: (store: unknown) => unknown) => select({ addReviewComment: (...args: unknown[]) => host.comments.push(args) }) }));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../DiffWorkerPoolProvider", () => ({ DiffWorkerPoolProvider: ({ children }: {children: React.ReactNode}) => children }));
vi.mock("../files/FilePreviewPanel", () => ({ useEditableAfterHighlight: () => ({ ready: true, onPostRender: () => {} }) }));
vi.mock("../files/FileBrowserPanel", () => ({ default: ({onOpenFile}: {onOpenFile:(path:string)=>void}) => <nav><button onClick={()=>onOpenFile("a.ts")}>Open a.ts</button><button onClick={()=>onOpenFile("b.ts")}>Open b.ts</button></nav> }));
// State/transport test uses a controllable editor boundary. Actual Pierre behavior is covered by
// upstream fileEditorDismissal and file editor/browser tests, not claimed by this shim.
vi.mock("../diffs/StyledDiffCodeView", () => ({ DIFF_VIEW_UNSAFE_CSS: "" }));
// A stand-in for the diff view: shows the old and new text so the test can tell which change is on screen.
vi.mock("@pierre/diffs/react", () => ({ MultiFileDiff: ({oldFile,newFile}: {oldFile:{contents:string};newFile:{contents:string}}) => <pre aria-label="Test diff">{oldFile.contents}{"=>"}{newFile.contents}</pre>, EditProvider: ({children}: {children:React.ReactNode})=>children, Virtualizer: ({children}: {children:React.ReactNode})=>children,
 File: ({file,edit,onEditChange,options}: {file:{contents:string};edit:boolean;onEditChange:(e:unknown)=>void;options:{onLineSelectionEnd:(r:unknown)=>void}}) => <><textarea key={file.contents} aria-label="Test code" defaultValue={file.contents} readOnly={!edit} onChange={e=>onEditChange({file:{contents:e.target.value}})}/><button onClick={()=>options.onLineSelectionEnd({start:1,end:1})}>Select first line</button></> }));
const env=EnvironmentId.make("ide-test"),thread={environmentId:env,threadId:ThreadId.make("ide-thread")};
const event=(id:string,path:string)=>({item:{id,type:"file_change",status:"completed",fileName:path}});
const panel=(items:ReturnType<typeof event>[],mutation="1",cwd="/ide-fixture")=><IdePanel environmentId={env} cwd={cwd} projectName="Fixture" composerDraftTarget={thread} items={items} workspaceMutationId={mutation}/>;
it("follows host paths, pauses for editing, retains drafts, resolves a conflict and adds path/range questions",async()=>{
 await using screen=await render(panel([event("a","a.ts")]));
 await expect.element(screen.getByRole("textbox",{name:"Test code"})).toHaveValue("first");
 await screen.rerender(panel([event("a","a.ts"),event("b","b.ts")],"2"));
 await expect.element(screen.getByRole("textbox",{name:"Test code"})).toHaveValue("second");
 await screen.getByRole("textbox",{name:"Test code"}).fill("my edit");
 host.files["b.ts"]="external";
 await screen.rerender(panel([event("a2","a.ts")],"3"));
 await expect.element(screen.getByText("External change — your draft is preserved")).toBeVisible();
 await expect.element(screen.getByRole("textbox",{name:"Test code"})).toHaveValue("my edit");
 await expect.element(screen.getByRole("button",{name:"Save",exact:true})).toBeDisabled();
 await screen.getByRole("button",{name:"Select first line"}).click();
 await screen.getByRole("textbox",{name:"Question about selected code"}).fill("Why?");
 await screen.getByRole("button",{name:"Add to chat"}).click();
 expect(host.comments[0]).toMatchObject([thread,{filePath:"b.ts",startIndex:0,endIndex:0,diff:"my edit",text:"Why?"}]);
 await screen.getByRole("button",{name:"Use incoming as save baseline; keep my draft"}).click();
 await screen.getByRole("button",{name:"Save",exact:true}).click();
 await vi.waitFor(()=>expect(host.files["b.ts"]).toBe("my edit"));
 expect(host.writes[0]).toMatchObject({relativePath:"b.ts",contents:"my edit",ideExpectedContents:"external"});
 await screen.getByRole("button",{name:"Open a.ts"}).click();
 await expect.element(screen.getByRole("textbox",{name:"Test code"})).toHaveValue("first");
 await screen.getByRole("textbox",{name:"Test code"}).fill("retained");
 await screen.rerender(<div>Chat mode</div>);
 await screen.rerender(panel([event("a","a.ts")],"4"));
 await expect.element(screen.getByRole("textbox",{name:"Test code"})).toHaveValue("retained");
});
it("old hosts cannot enter an editable IDE session",async()=>{
 host.safe=false;
 await using screen=await render(panel([event("a","a.ts")],"5","/old-host"));
 await expect.element(screen.getByRole("textbox",{name:"Test code"})).toHaveAttribute("readonly");
 await expect.element(screen.getByText("Read only:",{exact:false})).toBeVisible();
 host.safe=true;
});
it("shows each agent change as a diff in the order it landed, moving between files, then returns to the editor",async()=>{
 host.files={"a.ts":"one","b.ts":"two"};
 await using screen=await render(panel([event("a","a.ts"),event("b","b.ts")],"20","/flash-fixture"));
 // Following selects the newest file; the other changed file is read in the background.
 await expect.element(screen.getByRole("textbox",{name:"Test code"})).toHaveValue("two");
 await new Promise(resolve=>setTimeout(resolve,900));
 host.files["a.ts"]="one!";host.files["b.ts"]="two!";
 // Both changes are shown, one after the other. Which comes first depends on which read lands first.
 const seen=new Map<string,string>();
 await vi.waitFor(()=>{
  for(const name of ["a.ts","b.ts"]){
   if(screen.container.querySelector(`[aria-label='Agent change to ${name}']`))seen.set(name,screen.container.querySelector("[aria-label='Test diff']")?.textContent??"");
  }
  expect([...seen.keys()].sort()).toEqual(["a.ts","b.ts"]);
 },{timeout:8000,interval:40});
 expect(seen.get("a.ts")).toBe("one=>one!");
 expect(seen.get("b.ts")).toBe("two=>two!");
 await expect.element(screen.getByRole("textbox",{name:"Test code"}),{timeout:8000}).toHaveValue("two!");
});
it("does not cover a file with unsaved edits, and the toggle turns the change view off",async()=>{
 host.files={"a.ts":"one","b.ts":"two"};
 await using screen=await render(panel([event("a","a.ts")],"21","/flash-fixture-2"));
 await expect.element(screen.getByRole("textbox",{name:"Test code"})).toHaveValue("one");
 await screen.getByRole("textbox",{name:"Test code"}).fill("mine");
 host.files["a.ts"]="agent";
 await new Promise(resolve=>setTimeout(resolve,1500));
 expect(screen.container.querySelector("[aria-label='Agent change to a.ts']")).toBeNull();
 await screen.getByRole("textbox",{name:"Test code"}).fill("one");
 await screen.getByRole("button",{name:"Highlighting changes"}).click();
 await expect.element(screen.getByRole("button",{name:"Highlight changes"})).toBeVisible();
});
