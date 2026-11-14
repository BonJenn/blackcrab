import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { IdeCodeEditor } from "./IdePanel";

it("renders actual source, accepts typing through Pierre, and replaces external snapshots", async () => {
 await getSyntaxHighlighterPromise("text");
 const changed=vi.fn();
 const container=document.createElement("div");container.style.cssText="display:flex;width:900px;height:500px";
 await using screen=await render(<IdeCodeEditor path="sample.txt" contents="hello\n" writable onChange={changed} onSelection={()=>{}}/>,{container});
 await vi.waitFor(()=>expect(container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("hello"));
 const content=container.querySelector("diffs-container")!.shadowRoot!.querySelector<HTMLElement>("[contenteditable=true]")!;
 expect(content).toBeTruthy();
 content.focus();
 await userEvent.keyboard("{End}world");
 await vi.waitFor(()=>expect(changed).toHaveBeenCalled());
 expect(changed.mock.calls.at(-1)?.[0]).toContain("world");
 await screen.rerender(<IdeCodeEditor path="sample.txt" contents="external snapshot\n" writable onChange={changed} onSelection={()=>{}}/>);
 await vi.waitFor(()=>expect(container.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("external snapshot"));
});
