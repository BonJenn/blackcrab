import * as Haptics from "expo-haptics";

/**
 * Thin, fail-safe wrappers around expo-haptics. Haptics are a nicety, never a
 * correctness concern, so every call swallows errors (e.g. unsupported devices
 * or the simulator) rather than surfacing them.
 */

/** A light tap — used for tab switches and other light UI selections. */
export function tapHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** A soft success cue — used when the assistant's reply lands. */
export function replyHaptic(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => {},
  );
}
