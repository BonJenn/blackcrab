import { createPaneStore } from "./paneGrid";

/** The open panes live for the app session, so leaving pane mode and coming back keeps them. */
export const paneStore = createPaneStore();
