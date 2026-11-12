import fs from 'node:fs';
import path from 'node:path';
export const NAMESPACE = Object.freeze({"appId":"com.blackcrab.desktop.managed.nativekeychainqa.n44a10b1c0fee1234","name":"Blackcrab Native QA 44a10b1c0fee1234 Beta","scheme":"blackcrab","profile":"blackcrab-managed-v1"});
export const MAX_DESCRIPTOR_BYTES = 16384;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
/** One private owner-to-client FD message. Never accept environment/argv credential fallbacks. */
export function parseDescriptor(bytes) {
  if (!(typeof bytes === 'string' || Buffer.isBuffer(bytes)) || Buffer.byteLength(bytes) > MAX_DESCRIPTOR_BYTES) throw Error('Invalid managed desktop descriptor size');
  let value; try { value = JSON.parse(String(bytes)); } catch { throw Error('Invalid managed desktop descriptor JSON'); }
  if (!(exact(value, ['version', 'owner', 'profile', 'control','authorization'])||exact(value, ['version', 'owner', 'profile', 'control','authorization','browser'])) || value.version !== 1) throw Error('Unsupported managed desktop descriptor');
  const { owner, profile, control, authorization } = value;
  if (!exact(owner, ['kind', 'generation', 'environmentId', 'origin', 'serverVersion', 'orchestrationProtocolVersion']) || owner.kind !== 'blackcrab-managed-host' || !Number.isSafeInteger(owner.generation) || owner.generation < 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(owner.environmentId) || owner.serverVersion !== '0.1.7' || owner.orchestrationProtocolVersion !== 2) throw Error('Invalid managed desktop owner identity');
  if(!exact(authorization,['kind','credential','expiresAt','renewal'])||authorization.kind!=='paired-credential'||!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(authorization.credential)||!Number.isSafeInteger(authorization.expiresAt)||authorization.expiresAt<=Date.now()||authorization.expiresAt>Date.now()+86400000||!exact(authorization.renewal,['kind','fd'])||authorization.renewal.kind!=='owner-credential-fd-v1'||authorization.renewal.fd!==4)throw Error('Independent native pairing/renewal authorization is required');
  let origin; try { origin = new URL(owner.origin); } catch { throw Error('Invalid managed desktop origin'); }
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || origin.href !== owner.origin) throw Error('Managed desktop requires an exact loopback origin');
  if (!exact(profile, ['root', 'namespace', 'appId']) || profile.namespace !== NAMESPACE.profile || profile.appId !== NAMESPACE.appId || typeof profile.root !== 'string' || !path.isAbsolute(profile.root) || path.resolve(profile.root) !== profile.root || profile.root === path.parse(profile.root).root || profile.root.includes('\0')) throw Error('Invalid managed desktop profile namespace');
  if (!exact(control, ['kind']) || control.kind !== 'unavailable') throw Error('Unsupported managed desktop owner-control contract');
  if(Object.hasOwn(value,'browser')){const b=value.browser;if(!exact(b,['kind','path','key','generation','environmentId'])||b.kind!=='leased-uds-v2'||b.generation!==owner.generation||b.environmentId!==owner.environmentId||typeof b.key!=='string'||!/^[a-f0-9]{64}$/.test(b.key)||typeof b.path!=='string'||!path.isAbsolute(b.path)||path.resolve(b.path)!==b.path||b.path.includes('\0')||Buffer.byteLength(b.path)>100)throw Error('Invalid native browser capability');}
  return Object.freeze({ version: 1,...(value.browser?{browser:Object.freeze({...value.browser})}:{}), owner: Object.freeze({ ...owner }), profile: Object.freeze({ ...profile }), control: Object.freeze({ ...control }),authorization:Object.freeze({...authorization,renewal:Object.freeze({...authorization.renewal})}) });
}
export function inspectProfile(descriptor) {
  const root = descriptor.profile.root, stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(root) !== root || (process.getuid && stat.uid !== process.getuid()) || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw Error('Managed desktop profile must be an existing canonical private owned directory');
  return root;
}
export function readDescriptor(fd = 3) {
  const chunks = []; let size = 0;
  try { for (;;) { const chunk = Buffer.alloc(1024); const count = fs.readSync(fd, chunk, 0, chunk.length, null); if (!count) break; size += count; if (size > MAX_DESCRIPTOR_BYTES) throw Error('Managed desktop descriptor exceeds bound'); chunks.push(chunk.subarray(0, count)); } } finally { fs.closeSync(fd); }
  return parseDescriptor(Buffer.concat(chunks));
}
export function publicIdentity(descriptor) { return { version: descriptor.version, generation: descriptor.owner.generation, environmentId: descriptor.owner.environmentId, origin: descriptor.owner.origin, namespace: descriptor.profile.namespace, control: descriptor.control.kind }; }

export function inspectBrowserCapability(descriptor){
 const b=descriptor.browser;if(!b)return;if(process.platform==='win32')throw Error('Native browser Unix transport is unavailable on Windows');
 try{const dir=path.dirname(b.path),parent=fs.lstatSync(dir);if(!parent.isDirectory()||parent.isSymbolicLink()||fs.realpathSync(dir)!==dir||parent.uid!==process.getuid()||(parent.mode&0o777)!==0o700)throw Error('unsafe directory');try{const socket=fs.lstatSync(b.path);if(!socket.isSocket()||socket.uid!==process.getuid()||(socket.mode&0o777)!==0o600)throw Error('unsafe socket');}catch(error){if(error.code!=='ENOENT')throw error;}}
 catch{throw Error('Native browser capability unavailable or unsafe');}
}
