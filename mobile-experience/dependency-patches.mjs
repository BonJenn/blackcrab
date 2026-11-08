import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseAllDocuments } from 'yaml';
const execute = promisify(execFile), sha = b => createHash('sha256').update(b).digest('hex');
export const PATCH_PACKAGE_NAMES = new Set(['react-native-image-viewing', 'mdast-util-math', 'micromark-extension-llm-math', 'micromark-extension-gfm-table', 'micromark', 'mdast-util-to-hast', 'expo-audio', 'expo-video', 'expo-network', '@clerk/expo-native-components', '@expo/metro-config', 'expo-sharing', 'expo-widgets', '@legendapp/list', '@pierre/diffs', '@react-native-ai/apple', '@react-native-menu/menu', '@react-navigation/native-stack', 'react-native-gesture-handler', 'react-native-reanimated', 'react-native-keyboard-controller', 'react-native-pdf-jsi', 'react-native-webview', '@expo/ui', 'expo-modules-core', '@expo/fingerprint']);
const safe = p => typeof p === 'string' && !path.isAbsolute(p) && !p.includes('\\') && !p.includes(':') && !p.includes('\0') && p.split('/').every(s => s && s !== '.' && s !== '..');
export function dependencyPatchTargets(text) { const paths = new Set(); for (const line of text.split('\n'))
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        const token = line.slice(4).split('\t')[0];
        if (token === '/dev/null')
            continue;
        if (!/^[ab]\//.test(token) || !safe(token.slice(2)))
            throw new Error('Unsafe dependency patch path');
        paths.add(token.slice(2));
    } if (!paths.size)
    throw new Error('Empty dependency patch'); return [...paths].sort(); }
async function fileDigest(root, relative) { if (!safe(relative))
    throw new Error('Unsafe patch source'); let current = root; for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink())
            throw new Error('Dependency patch symlink');
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return null;
        throw e;
    }
} const stat = await fs.lstat(current); if (!stat.isFile())
    throw new Error('Dependency patch target is not a file'); return sha(await fs.readFile(current)); }
async function sourcePolicy(vendorRoot) {
 const document=parseAllDocuments(await fs.readFile(path.join(vendorRoot,'pnpm-workspace.yaml'),'utf8'))[0];if(document.errors.length)throw document.errors[0];
 const locks=parseAllDocuments(await fs.readFile(path.join(vendorRoot,'pnpm-lock.yaml'),'utf8')).map(d=>{if(d.errors.length)throw d.errors[0];return d.toJS();});
 return {patches:document.toJS().patchedDependencies, integrity(key){const matches=locks.map(d=>d.packages?.[key]?.resolution?.integrity).filter(Boolean);if(matches.length!==1)throw new Error('Missing original npm integrity '+key);return matches[0];}};
}
async function checkedPackageRoot(repoRoot,location){let root=await fs.realpath(repoRoot),current=root;if(!safe(location))throw new Error('Unsafe installed package path');for(const part of location.split('/')){current=path.join(current,part);const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Installed package path is linked or not a directory');}return current;}
function gitEnvironment(packageRoot) { const env = {...process.env, GIT_CEILING_DIRECTORIES:path.dirname(packageRoot), GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}; delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; return env; }
async function patch(packageRoot, diff) { await execute('git', ['apply', '--check', '--unidiff-zero', '-p1', diff], { cwd: packageRoot, env:gitEnvironment(packageRoot), maxBuffer: 1024 * 1024 }); await execute('git', ['apply', '--unidiff-zero', '-p1', diff], { cwd: packageRoot, env:gitEnvironment(packageRoot), maxBuffer: 1024 * 1024 }); }
export async function prepareDependencyPatchRegistry({ repoRoot, vendorRoot }) {
    const yaml = parseAllDocuments(await fs.readFile(path.join(vendorRoot, 'pnpm-workspace.yaml'), 'utf8'))[0];
    if (yaml.errors.length)
        throw yaml.errors[0];
    const source = yaml.toJS().patchedDependencies;
    const policy=await sourcePolicy(vendorRoot);
    const lock = JSON.parse(await fs.readFile(path.join(repoRoot, 'package-lock.json'), 'utf8')), records = [], plans = [];
    for (const [location, entry] of Object.entries(lock.packages ?? {}).sort(([a], [b]) => a < b ? -1 : 1)) {
        if (!location.includes('node_modules/') || entry.link || !(PATCH_PACKAGE_NAMES.has(location.split('node_modules/').at(-1)) || location.endsWith('node_modules/micromark-extension-math')))
            continue;
        const packageRoot = await checkedPackageRoot(repoRoot, location);
        const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
        if(location.endsWith('node_modules/micromark-extension-math')&&manifest.name!=='micromark-extension-llm-math')throw new Error('Upstream Markdown package alias differs');
        if (!PATCH_PACKAGE_NAMES.has(manifest.name))
            continue;
        const key = `${manifest.name}@${manifest.version}`, relative = source[key];
        if (!relative)
            throw new Error(`Installed patch package version differs: ${key}`);
        if(entry.integrity!==policy.integrity(key))throw new Error('Installed npm tar integrity differs from pinned source '+key);
        if (!entry.integrity)
            throw new Error(`Missing npm integrity ${key}`);
        const diff = path.join(vendorRoot, relative), bytes = await fs.readFile(diff), targets = dependencyPatchTargets(bytes.toString()), before = await Promise.all(targets.map(async (p) => ({ path: p, beforeSha256: await fileDigest(packageRoot, p) })));
        plans.push({ packageRoot, diff, before, descriptor: { name: manifest.name, version: manifest.version, location, integrity: entry.integrity, patch: relative, patchSha256: sha(bytes) } });
    }
    for (const { packageRoot, diff } of plans)
        await execute('git', ['apply', '--check', '--unidiff-zero', '-p1', diff], { cwd: packageRoot, env:gitEnvironment(packageRoot), maxBuffer: 1024 * 1024 });
    for (const { packageRoot, diff, before, descriptor } of plans) {
        await patch(packageRoot, diff);
        const files = await Promise.all(before.map(async (p) => ({ ...p, afterSha256: await fileDigest(packageRoot, p.path) })));
        records.push({ ...descriptor, files });
    }
    return { schema: 1, kind: 'blackcrab-pinned-mobile-npm-patches', patches: records };
}
export async function applyDependencyPatchRegistry({ repoRoot, vendorRoot, registry }) {
    if (registry.schema !== 1 || registry.kind !== 'blackcrab-pinned-mobile-npm-patches')
        throw new Error('Unknown dependency patch registry');
    const lock = JSON.parse(await fs.readFile(path.join(repoRoot, 'package-lock.json'), 'utf8'));
    const policy=await sourcePolicy(vendorRoot);
    for (const record of registry.patches) {
        if (!PATCH_PACKAGE_NAMES.has(record.name) || !safe(record.location) || !record.location.includes('node_modules/') || !safe(record.patch))
            throw new Error('Unsafe dependency patch descriptor');
        const packageRoot = await checkedPackageRoot(repoRoot, record.location), manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
        if (manifest.name !== record.name || manifest.version !== record.version || lock.packages[record.location]?.integrity !== record.integrity)
            throw new Error('Dependency package pin changed');
        if(record.patch!==policy.patches[record.name+'@'+record.version]||record.integrity!==policy.integrity(record.name+'@'+record.version))throw new Error('Dependency patch policy differs from pinned source');
        const diff = path.join(vendorRoot, record.patch), bytes = await fs.readFile(diff);
        if (sha(bytes) !== record.patchSha256 || JSON.stringify(dependencyPatchTargets(bytes.toString())) !== JSON.stringify(record.files.map(f => f.path)))
            throw new Error('Dependency patch descriptor changed');
        const states = await Promise.all(record.files.map(async (f) => ({ file: f, hash: await fileDigest(packageRoot, f.path) })));
        if (states.every(s => s.hash === s.file.afterSha256))
            continue;
        if (!states.every(s => s.hash === s.file.beforeSha256))
            throw new Error('Dependency source differs before patch');
        await patch(packageRoot, diff);
        for (const f of record.files)
            if (await fileDigest(packageRoot, f.path) !== f.afterSha256)
                throw new Error('Dependency patch output differs');
    }
    return { patches: registry.patches.length };
}
