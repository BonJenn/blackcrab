import { ensureNativeUI } from "./activation/ensure.mjs";
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const sha = b => createHash('sha256').update(b).digest('hex');
/** Owned output paths; upstream configs/App are never imported. */
export async function prepareMobileResources(repoRoot) {
    await ensureNativeUI(repoRoot);
    const mobile = path.join(repoRoot, 'apps/mobile'), source = path.join(repoRoot, 'vendor/t3-mobile'), require = createRequire(path.join(repoRoot, 'package.json'));
    const { build } = await import(pathToFileURL(require.resolve('@blackcrab/mobile-stream-builder')).href);
    const records = [];
    async function write(relative, bytes) {
        const target = path.join(mobile, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        let unchanged = false;
        try {
            const stat = await fs.lstat(target);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('Generated resource is linked or not a regular file');
            unchanged = Buffer.from(bytes).equals(await fs.readFile(target));
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!unchanged) {
            const pending = target + '.pending-' + randomUUID();
            try { await fs.writeFile(pending, bytes, { flag: 'wx' }); await fs.rename(pending, target); }
            finally { await fs.rm(pending, { force: true }); }
        }
        records.push({ path: `apps/mobile/${relative}`, sha256: sha(bytes), bytes: Buffer.byteLength(bytes) });
    }
    for (const [feature, name] of [['devices', 'Device'], ['browser', 'Preview']]) {
        const stem = `${name.toLowerCase()}-stream`, entry = path.join(source, 'apps/mobile/src/features', feature, `${stem}.browser.ts`);
        const result = await build({ configFile: false, root: mobile, envDir: false, envPrefix: [], logLevel: 'silent', build: { write: false, target: 'es2022', minify: true, lib: { entry, name: `T3${name}Stream`, formats: ['iife'] } } });
        const chunk = (Array.isArray(result) ? result : [result]).flatMap(r => 'output' in r ? r.output : []).find(o => o.type === 'chunk');
        if (!chunk)
            throw new Error('Missing stream script');
        await write(`.generated/${stem}/index.js`, `module.exports = ${JSON.stringify(chunk.code)};\n`);
        await write(`.generated/${stem}/package.json`, '{"main":"index.js"}\n');
    }
    const { generateThirdPartyLicenseManifest } = await import(pathToFileURL(path.join(source, 'scripts/lib/third-party-licenses.ts')).href);
    const config = JSON.parse(await fs.readFile(path.join(source, 'third-party-licenses.config.json'), 'utf8'));
    for (const item of [...config.customNotices, ...config.packageOverrides]) {
        if (item.noticeFile)
            item.noticeFile = path.resolve(source, item.noticeFile);
        if (item.noticeFiles)
            item.noticeFiles = item.noticeFiles.map(file => path.resolve(source, file));
    }
    const generatedRoot = path.join(mobile, '.generated');
    await fs.mkdir(generatedRoot, { recursive: true });
    await fs.cp(path.join(source, 'third-party-licenses/spdx'), path.join(generatedRoot, 'third-party-licenses/spdx'), { recursive: true });
    const mit = JSON.parse(await fs.readFile(path.join(source, 'third-party-licenses/spdx/v3.28.0/MIT.json'), 'utf8')).licenseText;
    const fastNotice = 'fast-base64-decode 1.0.0 declares MIT in its published package.json. Source: https://github.com/LinusU/fast-base64-decode\n\n' + mit.replace(/^Copyright[^\n]*(?:<year>|<copyright holders>|<owner>)[^\n]*\n?/m, '');
    await write('.generated/licenses/fast-base64-decode-1.0.0.txt', fastNotice);
    const rnPackage = require.resolve('react-native/package.json'), trPackage = require.resolve('tr46/package.json');
    const noticeInputs = [];
    for (const [name, version, file] of [['@blackcrab/remote-protocol', '0.0.0', path.join(repoRoot, 'LICENSE')], ['fast-base64-decode', '1.0.0', path.join(generatedRoot, 'licenses/fast-base64-decode-1.0.0.txt')], ['@react-native/normalize-colors', '0.74.89', path.join(path.dirname(rnPackage), 'LICENSE')], ['tr46', '0.0.3', path.join(path.dirname(trPackage), 'LICENSE.md')]]) {
        const bytes = await fs.readFile(file);
        noticeInputs.push({ name, version, input: path.relative(repoRoot, file).split(path.sep).join('/'), sha256: sha(bytes), supplemental: name === 'tr46' || name === '@react-native/normalize-colors' });
    }
    await write('.generated/licenses/NOTICE-INPUTS.json', JSON.stringify({ schema: 1, upstreamConfigSha256: sha(await fs.readFile(path.join(source, 'third-party-licenses.config.json'))), spdxMitSha256: sha(await fs.readFile(path.join(source, 'third-party-licenses/spdx/v3.28.0/MIT.json'))), notes: ['First-party Apache notice comes from the owned root LICENSE.', 'normalize-colors and legacy tr46 receive actual notices from installed pinned releases of the same upstream projects.', 'fast-base64-decode supplies only an MIT metadata declaration; pinned SPDX grant text is used without an invented copyright holder or year.'], inputs: noticeInputs }, null, 2) + '\n');
    config.packageOverrides.push({ name: '@blackcrab/remote-protocol', version: '0.0.0', license: 'Apache-2.0', noticeFile: path.join(repoRoot, 'LICENSE') }, { name: 'fast-base64-decode', version: '1.0.0', license: 'MIT', noticeFile: path.join(generatedRoot, 'licenses/fast-base64-decode-1.0.0.txt') }, { name: '@react-native/normalize-colors', version: '0.74.89', license: 'MIT', noticeFile: path.join(path.dirname(rnPackage), 'LICENSE') }, { name: 'tr46', version: '0.0.3', license: 'MIT', noticeFile: path.join(path.dirname(trPackage), 'LICENSE.md') });
    const configFile = path.join(generatedRoot, 'third-party-licenses.config.json');
    await fs.writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
    const license = await generateThirdPartyLicenseManifest({ configFile, packageManifests: [{ bundle: 'mobile', path: path.join(mobile, 'package.json') }] });
    await write('.generated/third-party-licenses/index.js', `module.exports = ${JSON.stringify(license)};\n`);
    await write('.generated/third-party-licenses/package.json', '{"main":"index.js"}\n');
    for (const file of ['global.css', 'generated-uniwind-themes.css', 'generated-uniwind-theme-names.json', 'generated-uniwind-default-theme-variables.json', 'clerk-theme.json'])
        await write(`.generated/styles/${file}`, await fs.readFile(path.join(source, 'apps/mobile', file)));
    const activationManifest = await fs.readFile(path.join(generatedRoot, 'native-ui/ACTIVATION-MANIFEST.json'));
    const activation = JSON.parse(activationManifest);
    await write('.generated/RESOURCE-MANIFEST.json', JSON.stringify({ schema: 1, source: { consumerManifestSha256: activation.consumerManifestSha256, activationRegistrySha256: activation.registrySha256, activationManifestSha256: sha(activationManifest) }, records }, null, 2) + '\n');
    return records;
}
