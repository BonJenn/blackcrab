import { randomUUID } from 'node:crypto';
import { assertOwnerFence, validateOwnerRequest } from './protocol.mjs';

/** No transport here. Every call is authorized by the injected native-private session port.
 * journal.commit must durably CAS sequence, atomically replace and fsync before resolving.
 * A thrown write is uncertain: do not retry an effect or assume the previous bytes survived.
 */
export async function createOwnerSupervisor({ environmentId, epoch = randomUUID(), journal, sessions,
  children, exposure, maxRequests = 1024, maxQueue = 32 }) {
  const saved = await journal.load();
  let record = saved ?? { environmentId, epoch, sequence: 0, revision: 0, requests: [] };
  if (record.environmentId !== environmentId || record.requests.some(x => x.phase === 'pending'))
    throw new Error('Owner journal requires reconciliation');
  // A fresh supervisor must never adopt a persisted PID or silently spawn over an existing owner.
  await children.assertAvailable();
  let lost = false, active = null, generation = 0, pending = 0, initialized = false, tail = Promise.resolve();
  const commit = async next => {
    try { await journal.commit(record.sequence, next); record = next; }
    catch (error) { lost = true; throw error; }
  };
  await commit({ ...record, epoch, sequence: record.sequence + 1 });
  const snapshot = () => Object.freeze({ environmentId, epoch, revision: record.revision,
    sequence: record.sequence, generation, running: active !== null, lostOwnership: lost });
  const ensure = async () => {
    if (lost) throw new Error('Owner lost ownership');
    try { await children.assertOwnership(); } catch (error) { lost = true; throw error; }
  };
  const launch = async () => {
    await ensure();
    const handle = await children.start(); // trusted startup configuration is bound in this port
    const owned = { handle, generation: ++generation };
    active = owned;
    handle.onExit(() => { if (active === owned) active = null; });
  };
  const stop = async () => {
    await ensure();
    const captured = active;
    if (!captured) return;
    await children.stop(captured.handle); // captured handle only, never a caller/persisted PID
    if (active === captured) active = null;
  };
  const restart = async () => { await stop(); await launch(); };
  const execute = async (session, input) => {
    await sessions.assertVerified(session, environmentId);
    await ensure();
    const request = assertOwnerFence(input, {environmentId, epoch, revision: record.revision,
      completedRequestIds: new Set(record.requests.map(x => x.id))});
    if (request.operation.type === 'status') return snapshot();
    if (record.requests.length >= maxRequests) throw new Error('Owner request journal full');
    const id = request.requestId;
    await commit({ ...record, sequence: record.sequence + 1,
      requests: [...record.requests, {id, phase:'pending'}] });
    try {
      const operation = request.operation;
      let result;
      switch (operation.type) {
        case 'setExposure':
          result = await exposure.setMode(operation.mode);
          if (result.requiresRelaunch) await restart();
          break;
        case 'setTailscaleServe':
          result = await exposure.setTailscaleServeEnabled({enabled:operation.enabled,
            ...(operation.port === undefined ? {} : {port:operation.port})});
          if (result.requiresRelaunch) await restart();
          break;
        case 'restart': await restart(); break;
        case 'stop': await stop(); break;
      }
      await ensure();
      await commit({ ...record, sequence: record.sequence + 1, revision: record.revision + 1,
        requests: record.requests.map(x => x.id === id ? {id,phase:'complete'} : x) });
      return { snapshot:snapshot(), ...(result === undefined ? {} : {result}) };
    } catch (error) {
      // Original service errors pass through unchanged. If an effect or write may have happened,
      // leave the pending journal entry and fail closed; never guess whether replay is safe.
      lost = true;
      throw error;
    }
  };
  return {
    snapshot,
    start() {
      if (initialized || pending) return Promise.reject(new Error('Owner already started'));
      initialized = true;
      // Publish initialization into the same queue before launch yields: an authenticated stop
      // arriving during startup must wait for the captured child rather than miss it.
      const run = launch().then(snapshot).catch(error => { lost = true; throw error; });
      tail = run.catch(() => {});
      return run;
    },
    request(session, input) {
      if (!initialized) return Promise.reject(new Error('Owner not started'));
      if (pending >= maxQueue) return Promise.reject(new Error('Owner queue full'));
      let captured;
      try { captured = validateOwnerRequest(input); } catch(error) { return Promise.reject(error); }
      pending++;
      const run = tail.then(() => execute(session, captured));
      tail = run.catch(() => {});
      return run.finally(() => { pending--; });
    },
    // A Root UI/session disconnect detaches only; there is deliberately no stop side effect.
    async detach(session) { await sessions.detach(session); },
    loseOwnership() { lost = true; },
  };
}
