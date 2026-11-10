/** One process-lifetime bridge between the host shell and managed navigation. */
export function createRootLifecycle() {
  let visible = true, voicePhase = "idle";
  const navigationListeners = new Set(), visibilityListeners = new Set();
  return Object.freeze({
    requestLegacy() {
      if (voicePhase !== "idle" && voicePhase !== "error") return false;
      this.setManagedVisible(false);
      return true;
    },
    setVoicePhase(phase) {
      voicePhase = phase;
      if (!visible && voicePhase !== "idle" && voicePhase !== "error") this.managedNavigation();
    },
    managedNavigation() { for (const listener of navigationListeners) listener(); },
    subscribeManagedNavigation(listener) { navigationListeners.add(listener); return () => { navigationListeners.delete(listener); }; },
    setManagedVisible(next) {
      if (visible === next) return;
      visible = next;
      for (const listener of visibilityListeners) listener(visible);
    },
    isManagedVisible: () => visible,
    subscribeVisibility(listener) { visibilityListeners.add(listener); listener(visible); return () => { visibilityListeners.delete(listener); }; },
  });
}
const slot = Symbol.for('blackcrab.mobile.managed-root-lifecycle.v1');
globalThis[slot] ??= createRootLifecycle();
export const managedRootLifecycle = globalThis[slot];
