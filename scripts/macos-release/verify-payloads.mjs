import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {verifyArtifact as verifyDesktop} from '../../managed-desktop/artifact.mjs';
import {verifyArtifact as verifyHost} from '../../managed-host/artifact.mjs';
import {verifyServiceProfileArtifact} from '../../managed-host/service-profile.mjs';
import {validateSigningIdentity, machoFiles, verifySignature} from './signatures.mjs';

const exec = promisify(execFile);
export function validateReleaseProvenance(provenance, {identity, teamId}) {
  validateSigningIdentity(identity, teamId);
  const signing = provenance?.distributionSigning;
  if (signing?.schema !== 1 || signing.kind !== 'developer-id' || signing.identity !== identity ||
      signing.teamId !== teamId || signing.notarized !== true ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(signing.submissionId ?? '')) {
    throw Error('Signed native releases require notarized managed payloads for the intended Developer ID');
  }
}

/** Supplement byte/provenance verification with the OS signature and stapled ticket checks. */
export async function verifyManagedReleasePayloads({desktop, host, serviceHost, identity, teamId}) {
  if ([desktop, host, serviceHost].every(value => value === undefined)) return;
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Managed release payloads currently require Apple silicon');
  validateSigningIdentity(identity, teamId);
  for (const [role, root] of [['desktop', desktop], ['host', host], ['serviceHost', serviceHost]]) {
    if (root === undefined) continue;
    await (role === 'desktop' ? verifyDesktop(root) : role === 'serviceHost' ? verifyServiceProfileArtifact(root) : verifyHost(root));
    const provenance = JSON.parse(await fs.readFile(path.join(root, 'BUILD-PROVENANCE.json'), 'utf8'));
    validateReleaseProvenance(provenance, {identity, teamId});
    const binaries = await machoFiles(root);
    if (!binaries.length) throw Error('Managed release payload contains no native code');
    for (const relative of binaries) await verifySignature(path.join(root, relative), {identity, teamId});
    if (role === 'desktop') {
      const app = path.join(root, 'Blackcrab.app');
      await verifySignature(app, {identity, teamId}, {deep:true});
      await exec('/usr/bin/xcrun', ['stapler', 'validate', app], {timeout:300000});
      await exec('/usr/sbin/spctl', ['--assess', '--type', 'execute', app], {timeout:300000});
    }
  }
}
