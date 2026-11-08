import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {UPSTREAM} from '../managed-host/artifact.mjs';
import { analyzeMobileExperience } from './graph.mjs';
import { analyzeMobileSlice } from '../shared-runtime/graph.mjs';
import { applySharedSourcePatches } from '../shared-runtime/patches.mjs';
import { verifyExperienceExport, resolveExperienceDependencies, inventoryExperience } from './export.mjs';
const digest = b => createHash('sha256').update(b).digest('hex');
const serialize = x => JSON.stringify(x, null, 2) + '\n';
const sorted = a => [...new Map(a.map(x => [JSON.stringify(x), x])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
export function unionConsumerGraphs(full, direct) {
    const files = new Map(full.files.map(f => [f.path, f]));
    for (const f of direct.files) {
        const old = files.get(f.path);
        if (old && old.sha256 !== f.sha256)
            throw new Error('Graph source hash disagreement');
        files.set(f.path, { ...f, runtime: f.runtime || old?.runtime || false });
    }
    const packages = new Map(full.packages.map(p => [p.name, p]));
    for (const p of direct.packages) {
        const old = packages.get(p.name);
        if (!old) {
            packages.set(p.name, p);
            continue;
        }
        if (old.manifestSha256 !== p.manifestSha256)
            throw new Error('Graph package disagreement');
        packages.set(p.name, { ...old, usedExports: sorted([...old.usedExports, ...p.usedExports]), dependencies: { workspace: [...new Set([...old.dependencies.workspace, ...p.dependencies.workspace])].sort(), external: [...new Set([...old.dependencies.external, ...p.dependencies.external])].sort() } });
    }
    return { ...full, seeds: [...new Set([...full.seeds, ...direct.seeds])].sort(), files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : 1), packages: [...packages.values()].sort((a, b) => a.name < b.name ? -1 : 1), edges: sorted([...full.edges, ...direct.edges]), externalNames: [...new Set([...full.externalNames, ...direct.externalNames])].sort() };
}
export function createExperienceConsumerManifests(graph, dependencyLock) {
    const manifests = {};
    for (const pkg of graph.packages.filter(p => p.folder !== 'apps/mobile')) {
        const owner = dependencyLock.owners.find(p => p.name === pkg.name);
        if (!owner)
            throw new Error(`Missing lock owner ${pkg.name}`);
        const dependencies = {};
        for (const name of pkg.dependencies.workspace) {
            const target = graph.packages.find(p => p.name === name);
            if (!target)
                throw new Error(`Missing consumer ${name}`);
            dependencies[name] = 'file:../' + path.posix.basename(target.folder);
        }
        for (const name of pkg.dependencies.external) {
            const edge = owner.actualExternalEdges.find(e => e.name === name);
            if (!edge || edge.kind)
                throw new Error(`Unpinned shared consumer dependency ${pkg.name}:${name}`);
            const pins = [...new Set(edge.groups.map(g => owner.groups[g][edge.manifestName].resolution).filter(Boolean))];
            if (pins.length !== 1)
                throw new Error('Ambiguous external pin');
            const version = pins[0].split('(')[0];
            if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version))
                throw new Error(`Not an exact registry pin ${version}`);
            dependencies[edge.manifestName] = version;
        }
        const exports = {};
        for (const edge of graph.edges.filter(e => e.workspace === pkg.name && e.specifier?.startsWith(pkg.name) && e.to)) {
            const key = edge.specifier === pkg.name ? '.' : './' + edge.specifier.slice(pkg.name.length + 1), target = './' + edge.to.slice(pkg.folder.length + 1);
            if (!target.startsWith('./src/'))
                throw new Error('Consumer export outside src');
            (exports[key] ??= {})[edge.resolutionMode === 'types' ? 'types' : 'import'] = target;
        }
        for (const usage of pkg.usedExports.filter(e => !e.key.includes('*'))) {
            const target = './' + usage.target.slice(pkg.folder.length + 1);
            (exports[usage.key] ??= {})[usage.conditions.includes('types') ? 'types' : 'import'] = target;
        }
        if (!Object.keys(exports).length)
            throw new Error(`No consumer exports ${pkg.name}`);
        const orderedExports = Object.fromEntries(Object.entries(exports).sort(([a], [b]) => a < b ? -1 : 1).map(([key, v]) => [key, { ...(v.types ? { types: v.types } : {}), ...(v.import ? { import: v.import, default: v.import } : {}) }]));
        manifests[`${pkg.folder}/package.json`] = { name: pkg.name, version: pkg.originalManifest.version ?? '0.0.0', private: true, type: 'module', license: pkg.originalManifest.license ?? 'MIT', exports: orderedExports, dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a < b ? -1 : 1)), ...(typeof pkg.originalManifest.sideEffects === 'boolean' ? { sideEffects: pkg.originalManifest.sideEffects } : {}) };
    }
    return manifests;
}
/** Generate consumers separately from the authenticated unchanged preparation bundle. */
export async function prepareExperienceConsumers({ preparation, output }) {
    await verifyExperienceExport(preparation);
    try {
        await fs.lstat(output);
        throw new Error('Consumer output already exists');
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    const stage = await fs.mkdtemp(path.join(path.dirname(path.resolve(output)), '.mobile-consumers-'));
    try {
        const source = stage;
        await fs.cp(path.join(preparation, 'source'), source, { recursive: true, errorOnExist: true });
        const patches = await applySharedSourcePatches(source);
        const graph = unionConsumerGraphs(analyzeMobileExperience(source, { includeGeneratedInputs: true }), analyzeMobileSlice(source));
        const inventory = JSON.parse(await fs.readFile(path.join(preparation, 'RESOURCE-INVENTORY.json'), 'utf8'));
        const lock = resolveExperienceDependencies(await fs.readFile(path.join(source, 'pnpm-lock.yaml'), 'utf8'), graph.packages, inventory.nativeModules);
        const manifests = createExperienceConsumerManifests(graph, lock), changes = [];
        for (const [relative, manifest] of Object.entries(manifests)) {
            const before = await fs.readFile(path.join(source, relative));
            const original = `original-manifests/${relative}`;
            await fs.mkdir(path.dirname(path.join(stage, original)), { recursive: true });
            await fs.writeFile(path.join(stage, original), before);
            const after = serialize(manifest);
            await fs.writeFile(path.join(source, relative), after);
            changes.push({ path: relative, originalPath: original, beforeSha256: digest(before), afterSha256: digest(after), reason: 'Only actual runtime/type source imports and existing six public direct connection entries; exact owned lock pins; no server executors/dev tools.' });
        }
        for (const file of patches.originals) {
            const target = path.join(stage, 'original-files', file.path);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, file.bytes);
        }
        await fs.writeFile(path.join(stage, '.gitattributes'), '* -text\n');
        await fs.copyFile(path.join(preparation, 'VENDOR-MANIFEST.json'), path.join(stage, 'PREPARATION-MANIFEST.json'));
        await fs.writeFile(path.join(stage, 'IMPORT-GRAPH.json'), serialize(graph));
        await fs.writeFile(path.join(stage, 'DEPENDENCY-LOCK.json'), serialize(lock));
        await fs.writeFile(path.join(stage, 'CONSUMER-CHANGES.json'), serialize({ sourcePatches: patches.patches, packageManifests: changes }));
        const payload = [];
        async function walk(folder, relative = '') { for (const name of (await fs.readdir(folder)).sort()) {
            const p = relative ? relative + '/' + name : name, full = path.join(folder, name), stat = await fs.lstat(full);
            if (stat.isSymbolicLink())
                throw new Error('Consumer symlink');
            if (stat.isDirectory())
                await walk(full, p);
            else {
                const b = await fs.readFile(full);
                payload.push({ path: p, bytes: b.length, sha256: digest(b) });
            }
        } }
        await walk(stage);
        const manifest = { schema: 1, kind: 'blackcrab-mobile-source-consumers', preparationManifestSha256: digest(await fs.readFile(path.join(preparation, 'VENDOR-MANIFEST.json'))), files: payload };
        await fs.writeFile(path.join(stage, 'CONSUMER-MANIFEST.json'), serialize(manifest));
        await fs.rename(stage, output);
        return { output, packages: Object.keys(manifests).length, sourceFiles: graph.files.length, manifestSha256: digest(serialize(manifest)) };
    }
    catch (e) {
        await fs.rm(stage, { recursive: true, force: true });
        throw e;
    }
}
export async function verifyExperienceConsumers(root) {
    const rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('Consumer root must be a real directory');root=await fs.realpath(root);
    for(const name of ['CONSUMER-MANIFEST.json','.gitattributes','PREPARATION-MANIFEST.json','IMPORT-GRAPH.json','CONSUMER-CHANGES.json','DEPENDENCY-LOCK.json']){const stat=await fs.lstat(path.join(root,name));if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>32*1024*1024)throw new Error('Invalid consumer metadata file');}

    const manifest = JSON.parse(await fs.readFile(path.join(root, 'CONSUMER-MANIFEST.json'), 'utf8'));
    if(await fs.readFile(path.join(root,'.gitattributes'),'utf8')!=='* -text\n')throw new Error('Consumer byte-preservation policy differs');
    if (manifest.schema !== 1 || manifest.kind !== 'blackcrab-mobile-source-consumers')
        throw new Error('Unsupported consumer provenance');
    const paths = new Set(['CONSUMER-MANIFEST.json']);
    for (const file of manifest.files) {
        if (typeof file.path !== 'string' || file.path.split('/').includes('node_modules') || file.path.includes('\\') || path.isAbsolute(file.path) || file.path.split('/').some(p => !p || p === '..' || p === '.') || paths.has(file.path))
            throw new Error('Unsafe consumer path');
        paths.add(file.path);
    }
    const preparationBytes = await fs.readFile(path.join(root, 'PREPARATION-MANIFEST.json'));
    if (digest(preparationBytes) !== manifest.preparationManifestSha256)
        throw new Error('Preparation provenance mismatch');
    const preparation = JSON.parse(preparationBytes);
    validatePreparationPaths(preparation);
    if(preparation.schema!==1||preparation.kind!=='blackcrab-mobile-experience-source-preparation'||serialize(preparation.upstream)!==serialize(UPSTREAM))throw new Error('Original preparation pin differs');
    const originalPackageFolders = preparation.files.filter(f => /^source\/packages\/[^/]+\/package.json$/.test(f.path)).map(f => f.path.slice(7, -13));
    const allowedInstalledRoots = new Set([...originalPackageFolders.map(folder => folder + '/node_modules'), ...['t3-highlights', 't3-review-diff', 't3-source-text', 't3-terminal'].map(name => 'apps/mobile/modules/' + name + '/node_modules')]);
    async function walk(folder, relative = '') { for (const name of await fs.readdir(folder)) {
        const p = relative ? relative + '/' + name : name, full = path.join(folder, name), stat = await fs.lstat(full);
        if (stat.isSymbolicLink())
            throw new Error('Consumer symlink');
        if (allowedInstalledRoots.has(p)) {
            if (!stat.isDirectory())
                throw new Error('Installed consumer dependencies are not a directory');
            continue;
        }
        if (stat.isDirectory())
            await walk(full, p);
        else if (!stat.isFile() || stat.nlink!==1 || !paths.has(p))
            throw new Error('Unexpected consumer payload');
    } }
    await walk(root);
    for (const item of manifest.files) {
        const bytes = await fs.readFile(path.join(root, item.path));
        if (bytes.length !== item.bytes || digest(bytes) !== item.sha256)
            throw new Error(`Consumer payload mismatch ${item.path}`);
    }
    const graph = JSON.parse(await fs.readFile(path.join(root, 'IMPORT-GRAPH.json'), 'utf8')), changes = JSON.parse(await fs.readFile(path.join(root, 'CONSUMER-CHANGES.json'), 'utf8')), lock = JSON.parse(await fs.readFile(path.join(root, 'DEPENDENCY-LOCK.json'), 'utf8'));
    const expectedFolders = [...originalPackageFolders, 'apps/mobile'].sort();
    if (serialize(graph.packages.map(p => p.folder).sort()) !== serialize(expectedFolders))throw new Error('Consumer package roots differ from original preparation');
    if(changes.sourcePatches?.length!==1||changes.sourcePatches[0].target!=='packages/client-runtime/src/rpc/session.ts'||changes.sourcePatches[0].id!=='rpc-send-parameter-types')throw new Error('Unexpected consumer source patches');
    if(changes.packageManifests?.length!==originalPackageFolders.length)throw new Error('Consumer manifest change count differs');
    for(const change of changes.packageManifests)if(!originalPackageFolders.some(folder=>change.path===folder+'/package.json')||change.originalPath!=='original-manifests/'+change.path||!paths.has(change.originalPath))throw new Error('Unsafe consumer original manifest path');
    for(const file of graph.files)if(!paths.has(file.path))throw new Error('Unsafe consumer graph file path');
    const inventory = await inventoryExperience(root, graph, { allowInstalledPackageDependencies: true });
    const recomputedLock = resolveExperienceDependencies(await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'), graph.packages, inventory.nativeModules);
    if (serialize(recomputedLock) !== serialize(lock))
        throw new Error('Consumer lock provenance mismatch');
    const changedPaths = new Set(changes.packageManifests.map(c => c.path));
    const patchedPaths = new Set(changes.sourcePatches.map(p => p.target));
    for (const file of preparation.files.filter(f => f.path.startsWith('source/'))) {
        const relative = file.path.slice(7);
        if (changedPaths.has(relative) || patchedPaths.has(relative))
            continue;
        const bytes = await fs.readFile(path.join(root, relative));
        if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
            throw new Error('Original source provenance mismatch');
    }
    const recomputedGraph = unionConsumerGraphs(analyzeMobileExperience(root, { includeGeneratedInputs: true }), analyzeMobileSlice(root));
    validateConsumerGraphClosure(graph, recomputedGraph);
    const generated = createExperienceConsumerManifests(graph, lock);
    for (const pkg of graph.packages.filter(p => p.folder !== 'apps/mobile')) {
        const relative = `${pkg.folder}/package.json`, change = changes.packageManifests.find(c => c.path === relative);
        if (!change)
            throw new Error('Missing consumer manifest change');
        const before = await fs.readFile(path.join(root, change.originalPath)), after = await fs.readFile(path.join(root, relative));
        if (digest(before)!==preparation.files.find(f=>f.path==='source/'+relative)?.sha256 || digest(before) !== pkg.manifestSha256 || digest(before) !== change.beforeSha256 || digest(after) !== change.afterSha256 || serialize(JSON.parse(before)) !== serialize(pkg.originalManifest) || after.toString() !== serialize(generated[relative]))
            throw new Error('Consumer manifest provenance mismatch');
    }
    for (const file of graph.files) {
        const bytes = await fs.readFile(path.join(root, file.path));
        if (digest(bytes) !== file.sha256 || bytes.length !== file.bytes)
            throw new Error('Consumer graph source mismatch');
    }
    const { validateSharedSourcePatch } = await import('../shared-runtime/patches.mjs');
    if (changes.sourcePatches.length !== 1)
        throw new Error('Unexpected consumer source patches');
    for (const patch of changes.sourcePatches)
        validateSharedSourcePatch(await fs.readFile(path.join(root, 'original-files', patch.target)), await fs.readFile(path.join(root, patch.target)), patch);
    return { packages: Object.keys(generated).length, files: manifest.files.length };
}
export function validateConsumerGraphClosure(expected, actual) {
    const normalized = graph => ({ seeds: graph.seeds, files: graph.files, externalNames: graph.externalNames, edges: sorted(graph.edges.map(({ from, specifier, kind, typeOnly, line, resolutionMode, to, external, fromPackage, workspace }) => ({ from, specifier, kind, typeOnly, line, resolutionMode, to, external, fromPackage, workspace }))), packages: graph.packages.map(p => ({ name: p.name, folder: p.folder, dependencies: p.dependencies })).sort((a, b) => a.name < b.name ? -1 : 1) });
    if (serialize(normalized(expected)) !== serialize(normalized(actual)))
        throw new Error('Actual consumer source closure differs from provenance');
}

export function validatePreparationPaths(preparation){
 if(!Array.isArray(preparation.files)||preparation.files.length>16000)throw new Error('Invalid original preparation records');const seen=new Set();
 for(const file of preparation.files){const p=file.path;if(typeof p!=='string'||path.isAbsolute(p)||/[\\:\r\n\0]/.test(p)||p.split('/').some(part=>!part||part==='.'||part==='..'||part==='node_modules')||seen.has(p))throw new Error('Unsafe original preparation path');seen.add(p);}
}
