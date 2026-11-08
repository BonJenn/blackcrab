/** No child, signal, state-directory ownership or replay authority exists in this adapter. */
export function createAttachment({ verify, onReady, onDetach = () => {} }) {
  let epoch = 0, ready = false;
  return Object.freeze({
    get ready() { return ready; },
    async start() { const current = ++epoch; ready = false; await verify(); if (current !== epoch) return; ready = true; try { await onReady(); } catch (error) { if (current === epoch) ready = false; throw error; } },
    stop() { ++epoch; ready = false; onDetach(); },
  });
}
