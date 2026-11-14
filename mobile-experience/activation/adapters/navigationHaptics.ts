import * as Haptics from "expo-haptics";

/** Feedback must never delay navigation or fail an action on unsupported devices. */
export function navigationSelectionFeedback(): void {
  try { void Haptics.selectionAsync().catch(() => undefined); } catch { /* Optional feedback. */ }
}

export function navigationComposeFeedback(): void {
  try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); } catch { /* Optional feedback. */ }
}
