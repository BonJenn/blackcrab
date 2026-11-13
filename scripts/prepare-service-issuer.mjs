import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {validateSigningIdentity, validateSignatureDetails} from './macos-release/signatures.mjs';
import {notarizationEnvironment} from './macos-release/notarization-auth.mjs';

const exec = promisify(execFile);
// The signed helper is embedded as bytes in Root, rather than as a Mach-O
// resource that Tauri might re-sign after its hash/identity has been selected.
export async function prepareServiceIssuer({env, target, signed, cwd = process.cwd(), run = exec}) {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'blackcrab-service-issuer-'));
  const cleanup = () => fs.rm(stage, {recursive: true, force: true});
  const step = async (label, command, args, options = {}) => {
    try { return await run(command, args, {cwd, timeout: 1800000, maxBuffer: 4 * 1024 * 1024, ...options}); }
    catch { throw Error(`Standalone service helper ${label} failed`); }
  };
  try {
    const buildEnv = {...env};
    delete buildEnv.BLACKCRAB_SERVICE_ISSUER_PATH;
    for (const key of Object.keys(buildEnv)) if (/^(APPLE_|TAURI_SIGNING_)/.test(key)) delete buildEnv[key];
    // generate_context! in the shared native library needs the production web assets.
    await step('web build', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {env: buildEnv});
    await step('compile', 'cargo', ['build', '--locked', '--release', '--manifest-path', 'src-tauri/Cargo.toml',
      '--features', 'service-issuer', '--bin', 'blackcrab-service-issuer', ...(target ? ['--target', target] : [])], {env: buildEnv});
    const targetRoot = path.resolve(cwd, env.CARGO_TARGET_DIR || 'src-tauri/target');
    const built = path.join(targetRoot, ...(target ? [target] : []), 'release/blackcrab-service-issuer');
    const helper = path.join(stage, 'blackcrab-issuer');
    await fs.copyFile(built, helper);
    await fs.chmod(helper, 0o700);
    if (signed) validateSigningIdentity(env.APPLE_SIGNING_IDENTITY, env.APPLE_TEAM_ID);
    await step('signing', '/usr/bin/codesign', ['--force', '--sign', signed ? env.APPLE_SIGNING_IDENTITY : '-',
      '--identifier', 'com.bonjenn.blackcrab.service-issuer', '--options', 'runtime', ...(signed ? ['--timestamp'] : []), helper]);
    await step('signature verification', '/usr/bin/codesign', ['--verify', '--strict', helper]);
    let submissionId;
    if (signed) {
      const {stderr} = await step('signature details', '/usr/bin/codesign', ['-d', '--verbose=4', helper]);
      validateSignatureDetails(stderr, {identity: env.APPLE_SIGNING_IDENTITY, teamId: env.APPLE_TEAM_ID});
      const auth = notarizationEnvironment(env);
      const args = auth.mode === 'api-key'
        ? ['--key', auth.env.APPLE_API_KEY_PATH, '--key-id', auth.env.APPLE_API_KEY, '--issuer', auth.env.APPLE_API_ISSUER]
        : ['--apple-id', auth.env.APPLE_ID, '--password', auth.env.APPLE_PASSWORD, '--team-id', auth.env.APPLE_TEAM_ID];
      const archive = path.join(stage, 'service-issuer.zip');
      await step('notarization archive', '/usr/bin/ditto', ['-c', '-k', '--keepParent', helper, archive]);
      const {stdout} = await step('notarization', '/usr/bin/xcrun', ['notarytool', 'submit', archive, ...args,
        '--wait', '--timeout', '30m', '--output-format', 'json'], {timeout: 31 * 60 * 1000});
      const notarization = JSON.parse(stdout);
      if (notarization.status !== 'Accepted') throw Error('Standalone service helper notarization was not accepted');
      submissionId = notarization.id;
    }
    const sha256 = createHash('sha256').update(await fs.readFile(helper)).digest('hex');
    return {path: helper, sha256, notarizationSubmissionId: submissionId, cleanup};
  } catch (error) { await cleanup(); throw error; }
}
