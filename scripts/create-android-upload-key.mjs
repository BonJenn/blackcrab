#!/usr/bin/env node
/**
 * Creates the Blackcrab Remote Google Play *upload* key.
 *
 * With Play App Signing, Google holds the app signing key; this key only proves uploads come from Blackcrab.
 * Everything secret stays in one owner-only directory outside any repository:
 *   upload-keystore.p12          the key pair
 *   upload-key.properties        storeFile, passwords, alias (consumed by prepare-mobile-android.mjs)
 *   upload-certificate.pem       public certificate (safe to share; Play asks for it when resetting the key)
 * Passwords are generated here, passed to keytool only through an environment variable, and never printed.
 * An existing key is never overwritten. Back the directory up somewhere private: losing it forces a Play key reset.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify, parseArgs } from 'node:util';

const execute = promisify(execFile);
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
export const DEFAULT_DISTINGUISHED_NAME = 'CN=Blackcrab Remote Upload, O=Blackcrab';

export async function createUploadKey({ keytool, directory, alias = 'blackcrab-upload', distinguishedName = DEFAULT_DISTINGUISHED_NAME, validityDays = 10_000 } = {}) {
  if (!keytool) throw new Error('Pass --java-home (JDK 17) or the keytool path.');
  if (!ALIAS.test(alias)) throw new Error('Unsupported key alias.');
  const dir = path.resolve(directory);
  if (/[\s'"\\$]/.test(dir)) throw new Error('Key directory must not contain whitespace, quotes, backslashes or $.');
  const files = { storeFile: path.join(dir, 'upload-keystore.p12'), propertiesFile: path.join(dir, 'upload-key.properties'), certificateFile: path.join(dir, 'upload-certificate.pem') };
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  for (const file of Object.values(files)) {
    if (await fs.access(file).then(() => true, () => false)) throw new Error(`Refusing to overwrite an existing upload key file: ${file}`);
  }
  const password = randomBytes(32).toString('base64url');
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? os.homedir(), BLACKCRAB_UPLOAD_PASSWORD: password };
  const secret = ['-storepass:env', 'BLACKCRAB_UPLOAD_PASSWORD', '-keypass:env', 'BLACKCRAB_UPLOAD_PASSWORD'];
  try {
    await execute(keytool, ['-genkeypair', '-storetype', 'PKCS12', '-keystore', files.storeFile, '-alias', alias, '-keyalg', 'RSA', '-keysize', '4096', '-validity', String(validityDays), '-dname', distinguishedName, ...secret], { env });
    await fs.chmod(files.storeFile, 0o600);
    await execute(keytool, ['-exportcert', '-rfc', '-keystore', files.storeFile, '-alias', alias, '-file', files.certificateFile, '-storepass:env', 'BLACKCRAB_UPLOAD_PASSWORD'], { env });
    const properties = `storeFile=${files.storeFile}\nstorePassword=${password}\nkeyAlias=${alias}\nkeyPassword=${password}\ncertificateFile=${files.certificateFile}\n`;
    await fs.writeFile(files.propertiesFile, properties, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    await Promise.all(Object.values(files).map(file => fs.rm(file, { force: true })));
    throw new Error(`Upload key creation failed and partial files were removed: ${String(error.message).replaceAll(password, '[redacted]')}`);
  }
  const printed = (await execute(keytool, ['-printcert', '-file', files.certificateFile])).stdout;
  return { directory: dir, ...files, keyAlias: alias, certificateSha256: /SHA256:\s*([0-9A-F:]{95})/.exec(printed)?.[1] };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { 'java-home': { type: 'string' }, directory: { type: 'string' }, alias: { type: 'string' } } });
  try {
    const javaHome = values['java-home'] ?? process.env.JAVA_HOME;
    if (!javaHome) throw new Error('Set JAVA_HOME or pass --java-home.');
    const result = await createUploadKey({
      keytool: path.join(javaHome, 'bin/keytool'),
      directory: values.directory ?? path.join(os.homedir(), '.blackcrab-android/signing'),
      alias: values.alias,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
