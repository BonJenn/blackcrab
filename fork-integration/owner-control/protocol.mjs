/** Proposed private owner protocol, NOT a transport/authentication implementation. */
const keys = (value, expected) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) throw new Error('Invalid owner message shape');
};
const token = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function validateOwnerRequest(value) {
  keys(value, ['protocol', 'environmentId', 'epoch', 'revision', 'requestId', 'operation']);
  if (value.protocol !== 1 || !token(value.environmentId) || !token(value.epoch) || !token(value.requestId) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid owner fence');
  const operation = value.operation;
  if (!operation || typeof operation !== 'object') throw new Error('Invalid operation');
  switch (operation.type) {
    case 'status': case 'restart': case 'stop': keys(operation, ['type']); break;
    case 'setExposure':
      keys(operation, ['type', 'mode']);
      if (!['local-only', 'network-accessible'].includes(operation.mode)) throw new Error('Invalid exposure mode');
      break;
    case 'setTailscaleServe':
      keys(operation, operation.port === undefined ? ['type', 'enabled'] : ['type', 'enabled', 'port']);
      if (typeof operation.enabled !== 'boolean' || (operation.port !== undefined &&
          (!Number.isInteger(operation.port) || operation.port < 1 || operation.port > 65535))) throw new Error('Invalid Serve input');
      break;
    default: throw new Error('Unsupported owner operation');
  }
  return structuredClone(value);
}
/** Invoke under the supervisor mutation mutex, AFTER authenticating the peer.
 * This checks fences only. It neither persists nor advances revision nor caches replies.
 */
export function assertOwnerFence(request, current) {
  const value = validateOwnerRequest(request);
  if (value.environmentId !== current.environmentId) throw new Error('Owner environment mismatch');
  if (value.epoch !== current.epoch) throw new Error('Owner incarnation mismatch');
  if (value.revision !== current.revision) throw new Error('Owner revision conflict');
  if (current.completedRequestIds.has(value.requestId)) throw new Error('Owner request replay');
  return value;
}
