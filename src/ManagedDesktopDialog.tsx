import { useEffect, useRef } from "react";
import { ManagedServiceControls } from "./ManagedServiceControls";
import { ManagedNativeDesktopEntry } from "./ManagedNativeDesktopEntry";
import "./ManagedWorkspaceEntry.css";

export function ManagedDesktopDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="managed-desktop-dialog" aria-labelledby="managed-desktop-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="managed-desktop-dialog-heading">
      <h2 id="managed-desktop-title">Full desktop</h2>
      <button type="button" onClick={onClose} aria-label="Close full desktop setup">×</button>
    </div>
    <p>Use the full workspace with projects, agents, source control and terminals.</p>
    <ManagedServiceControls />
    <ManagedNativeDesktopEntry />
  </dialog>;
}
