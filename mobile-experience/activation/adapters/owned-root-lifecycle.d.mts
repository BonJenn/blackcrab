export interface RootLifecycle {
 requestLegacy(): boolean;
 setVoicePhase(phase: string): void;
 managedNavigation(): void;
 subscribeManagedNavigation(listener: () => void): () => void;
 setManagedVisible(visible: boolean): void;
 isManagedVisible(): boolean;
 subscribeVisibility(listener: (visible: boolean) => void): () => void;
}
export function createRootLifecycle(): RootLifecycle;
export const managedRootLifecycle: RootLifecycle;
