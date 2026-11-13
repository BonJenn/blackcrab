import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import "~/index.css";
import { PaneHeaderControls } from "./PaneHeaderControls";
import { PanelLayoutControls, ThreadPanelHeaderControl, WorkspaceTitlebarControls } from "../chat/PanelLayoutControls";

it.each([false, true])("pane controls remain hittable with the right panel open=%s", async (open) => {
  const previous = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1440, 900);
  await using _restore = { [Symbol.asyncDispose]: () => page.viewport(previous.width, previous.height) };
  const closed = vi.fn();
  const props = {
    terminalAvailable: true, terminalOpen: false, terminalShortcutLabel: null,
    threadPanelOpen: false, threadPanelPresentation: "inline" as const, threadPanelShortcutLabel: null,
    rightPanelAvailable: true, rightPanelOpen: open, rightPanelShortcutLabel: null,
    onToggleTerminal: vi.fn(), onToggleThreadPanel: vi.fn(), onToggleRightPanel: vi.fn(),
  };
  await using screen = await render(
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, width: 1400 }}>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} data-pane-index={index} className="group/pane relative flex min-w-0 border" style={{ height: 180 }}>
          {open ? <WorkspaceTitlebarControls placement="pane" showMaximizeControl rightPanelOpen animationsActive={false} maximized={false} onToggleMaximized={() => {}}><PanelLayoutControls {...props} showThreadPanelControl={false} /></WorkspaceTitlebarControls> : null}
          <div className="min-w-0 flex-1">
            <header className="drag-region flex h-[var(--workspace-topbar-height)] min-w-0 items-center px-3">
              <span className="min-w-0 flex-1 truncate">A long conversation title that must give room to the controls</span>
              <PaneHeaderControls index={index} onClose={() => closed(index)} />
              {open ? <ThreadPanelHeaderControl {...props} inline /> : <WorkspaceTitlebarControls placement="inline" showMaximizeControl rightPanelOpen={false} animationsActive={false} maximized={false} onToggleMaximized={() => {}}><PanelLayoutControls {...props} /></WorkspaceTitlebarControls>}
            </header>
          </div>
          {open ? <aside className="shrink-0 border-l" style={{ width: 150 }}>Panel</aside> : null}
        </div>
      ))}
    </div>,
  );
  for (const pane of screen.container.querySelectorAll<HTMLElement>("[data-pane-index]")) {
    const buttons = pane.querySelectorAll<HTMLButtonElement>('button[aria-label="Close pane"], button[aria-label="Drag to move pane"]');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.left).toBeGreaterThanOrEqual(pane.getBoundingClientRect().left);
      expect(box.right).toBeLessThanOrEqual(pane.getBoundingClientRect().right);
      expect(button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))).toBe(true);
      expect(getComputedStyle(button.parentElement!).getPropertyValue("-webkit-app-region")).toBe("no-drag");
    }
  }
  await page.elementLocator(screen.container.querySelector<HTMLButtonElement>('[data-pane-index="2"] button[aria-label="Close pane"]')!).click();
  expect(closed).toHaveBeenCalledWith(2);
});
