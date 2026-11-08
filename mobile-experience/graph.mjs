import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const ALLOWED_EXTERNALS = new Set(["@clerk/expo", "@effect/atom-react", "@expo/ui", "@legendapp/list", "@noble/curves", "@noble/hashes", "@pierre/diffs", "@react-native-ai/apple", "@react-native-menu/menu", "@react-navigation/elements", "@react-navigation/native", "@react-navigation/native-stack", "@t3tools/mobile-device-stream", "@t3tools/mobile-highlights-native", "@t3tools/mobile-preview-stream", "@t3tools/mobile-source-text", "@t3tools/mobile-third-party-licenses", "@tabler/icons-react-native", "clsx", "diff", "effect", "expo", "expo-application", "expo-audio", "expo-blur", "expo-camera", "expo-clipboard", "expo-constants", "expo-crypto", "expo-device", "expo-document-picker", "expo-file-system", "expo-glass-effect", "expo-haptics", "expo-image", "expo-image-manipulator", "expo-image-picker", "expo-keep-awake", "expo-linking", "expo-network", "expo-notifications", "expo-observe", "expo-paste-input", "expo-quick-actions", "expo-secure-store", "expo-sensors", "expo-sharing", "expo-splash-screen", "expo-sqlite", "expo-symbols", "expo-updates", "expo-video", "expo-widgets", "jszip", "mdast", "mdast-util-directive", "micromark-extension-directive", "micromark-util-character", "micromark-util-types", "react", "react-native", "react-native-enriched-markdown", "react-native-gesture-handler", "react-native-keyboard-controller", "react-native-nitro-modules", "react-native-reanimated", "react-native-safe-area-context", "react-native-screens", "react-native-svg", "react-native-webview", "react-native-worklets", "remark-gfm", "remark-math", "remark-parse", "tailwind-merge", "unified", "uniwind"]);
const BUILTINS = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`Invalid mobile experience source: ${message}`); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const packageName = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

/** Static source closure, not a Metro, Hermes or external-package compatibility proof. */
export function analyzeMobileExperience(sourceRoot, { includeGeneratedInputs = false } = {}) {
  const requestedRoot = path.resolve(sourceRoot);
  const rootStat = fs.lstatSync(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('source root must be a real directory');
  const root = fs.realpathSync(requestedRoot);
  const contents = new Map();
  const relative = file => path.relative(root, file).split(path.sep).join('/');
  function checked(file) {
    const rel = relative(path.resolve(file));
    if (!rel || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) fail('path escapes source root');
    let current = root;
    for (const part of rel.split('/')) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) fail(`symbolic link: ${rel}`);
    }
    return path.resolve(file);
  }
  function read(file) {
    checked(file);
    if (!fs.lstatSync(file).isFile()) fail(`not a regular file: ${relative(file)}`);
    if (!contents.has(file)) contents.set(file, fs.readFileSync(file));
    return contents.get(file);
  }
  function resolveFile(file) {
    const rel = relative(path.resolve(file));
    if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) fail('path escapes source root');
    const base = file.replace(/\.(?:tsx?|jsx?)$/, '');
    const candidates = ['.ios.tsx', '.ios.ts', '.native.tsx', '.native.ts'].map(suffix => base + suffix);
    candidates.push(file);
    if (/\.[cm]?js$/.test(file)) candidates.push(file.replace(/\.[cm]?js$/, '.ts'), file.replace(/\.[cm]?js$/, '.tsx'));
    candidates.push(...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'].map(suffix => file + suffix));
    candidates.push(...['index.ts', 'index.tsx', 'index.js'].map(name => path.join(file, name)));
    for (const candidate of candidates) {
      try {
        const stat = fs.lstatSync(candidate);
        checked(candidate);
        if (stat.isFile()) return candidate;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
    fail(`unresolved source file: ${rel}`);
  }
  const packageDirectory = path.join(root, 'packages');
  checked(packageDirectory);
  const packages = new Map();
  for (const directory of fs.readdirSync(packageDirectory).sort(compare)) {
    const folder = path.join(packageDirectory, directory);
    checked(folder);
    if (!fs.lstatSync(folder).isDirectory()) continue;
    const manifestPath = path.join(folder, 'package.json');
    let bytes;
    try { bytes = read(manifestPath); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (!record(manifest) || typeof manifest.name !== 'string' || !manifest.name) fail(`invalid package manifest: ${relative(manifestPath)}`);
    if (packages.has(manifest.name)) fail(`duplicate workspace package: ${manifest.name}`);
    packages.set(manifest.name, { name: manifest.name, folder, originalManifest: manifest, manifestSha256: digest(bytes), usedExports: new Map() });
  }
  {
    const folder = path.join(root, 'apps/mobile');
    const bytes = read(path.join(folder, 'package.json'));
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (packages.has(manifest.name)) fail('duplicate mobile package name');
    packages.set(manifest.name, {name: manifest.name, folder, originalManifest: manifest, manifestSha256: digest(bytes), usedExports: new Map()});
  }
  const owner = file => [...packages.values()].find(pkg => file.startsWith(pkg.folder + path.sep));
  function runtimeTargets(value, targets = new Set()) {
    if (typeof value === 'string') targets.add(value);
    else if (Array.isArray(value)) for (const entry of value) runtimeTargets(entry, targets);
    else if (record(value)) for (const [key, entry] of Object.entries(value)) if (key !== 'types') runtimeTargets(entry, targets);
    return targets;
  }
  function chooseTarget(value, mode, callKind, conditions = []) {
    if (typeof value === 'string') return { target: value, conditions };
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) { const result = chooseTarget(value[i], mode, callKind, [...conditions, String(i)]); if (result) return result; }
    } else if (record(value)) {
      if (mode === 'types' && Object.hasOwn(value, 'types')) {
        const result = chooseTarget(value.types, mode, callKind, [...conditions, 'types']);
        if (result) return result;
      }
      const active = new Set(['react-native', 'default', callKind === 'require' || callKind === 'import-equals' ? 'require' : 'import']);
      for (const [condition, entry] of Object.entries(value)) if (active.has(condition)) {
        const result = chooseTarget(entry, mode, callKind, [...conditions, condition]);
        if (result) return result;
      }
    }
    return null;
  }
  function workspaceExport(pkg, key, mode, callKind) {
    const exports = pkg.originalManifest.exports;
    let value, matchedKey = key, capture = null;
    if (typeof exports === 'string' || Array.isArray(exports) || (record(exports) && !Object.keys(exports).some(name => name.startsWith('.')))) {
      if (key === '.') value = exports;
    } else if (record(exports)) {
      value = exports[key];
      if (value === undefined) {
        const patterns = Object.keys(exports).filter(name => name.split('*').length === 2).sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length || compare(a, b));
        for (const pattern of patterns) {
          const [before, after] = pattern.split('*');
          if (key.startsWith(before) && key.endsWith(after) && key.length >= before.length + after.length) {
            value = exports[pattern]; matchedKey = pattern; capture = key.slice(before.length, key.length - after.length); break;
          }
        }
      }
    }
    if (value === undefined) fail(`unresolved workspace export: ${pkg.name}${key === '.' ? '' : key.slice(1)}`);
    if (runtimeTargets(value).size > 1) fail(`ambiguous divergent runtime export targets: ${pkg.name} ${matchedKey}`);
    const selected = chooseTarget(value, mode, callKind);
    if (!selected) fail(`unsupported workspace export conditions: ${pkg.name} ${matchedKey}`);
    const target = capture === null ? selected.target : selected.target.replaceAll('*', capture);
    if (!target.startsWith('./') || target.includes('\\') || target.includes('\0') || target.split('/').includes('..')) fail(`unsafe workspace export target: ${pkg.name} ${matchedKey}`);
    const file = resolveFile(path.join(pkg.folder, target));
    if (!file.startsWith(pkg.folder + path.sep)) fail('workspace export escapes its package');
    const usage = { key: matchedKey, conditions: selected.conditions, target: relative(file) };
    pkg.usedExports.set(JSON.stringify(usage), usage);
    return { file, workspace: pkg.name, exportKey: matchedKey, conditions: selected.conditions };
  }
  function resolve(specifier, from, mode, kind) {
    if (!specifier || specifier.includes('\\') || specifier.includes('\0')) fail('unsafe import specifier');
    if (specifier.startsWith('node:') || BUILTINS.has(specifier)) fail(`Node builtin import: ${relative(from)} -> ${specifier}`);
    if (path.isAbsolute(specifier) || /^[A-Za-z]:/.test(specifier)) fail('absolute import path is not allowed');
    if (specifier.startsWith('.')) return { file: resolveFile(path.resolve(path.dirname(from), specifier)) };
    if (specifier.split('/').some(part => part === '..' || part === '.')) fail('unsafe package subpath');
    const name = packageName(specifier), pkg = packages.get(name);
    if (pkg) return workspaceExport(pkg, specifier === name ? '.' : './' + specifier.slice(name.length + 1), mode, kind);
    if (!ALLOWED_EXTERNALS.has(name)) fail(`unsupported external dependency: ${name}`);
    return { external: name };
  }
  const parsed = new Map();
  function imports(file) {
    if (parsed.has(file)) return parsed.get(file);
    const bytes = read(file), rows = [];
    if (/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/.test(file)) {
      const ast = ts.createSourceFile(file, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
      if (ast.parseDiagnostics.length) fail(`invalid TypeScript syntax: ${relative(file)}`);
      const add = (node, specifier, kind, typeOnly) => rows.push({ specifier, kind, typeOnly: !!typeOnly, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
      function visit(node) {
        if (ts.isImportDeclaration(node)) {
          if (!ts.isStringLiteralLike(node.moduleSpecifier)) fail('nonliteral module import');
          const clause = node.importClause;
          const only = clause && (clause.isTypeOnly || (!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(entry => entry.isTypeOnly)));
          add(node, node.moduleSpecifier.text, 'import', only);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
          if (!ts.isStringLiteralLike(node.moduleSpecifier)) fail('nonliteral module export');
          const only = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(entry => entry.isTypeOnly));
          add(node, node.moduleSpecifier.text, 'export', only);
        } else if (ts.isImportTypeNode(node)) {
          if (!ts.isLiteralTypeNode(node.argument) || !ts.isStringLiteralLike(node.argument.literal)) fail('nonliteral import type');
          add(node, node.argument.literal.text, 'import-type-query', true);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
          if (!node.moduleReference.expression || !ts.isStringLiteralLike(node.moduleReference.expression)) fail('nonliteral import-equals');
          add(node, node.moduleReference.expression.text, 'import-equals', node.isTypeOnly);
        } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) fail(`nonliteral dynamic import/require: ${relative(file)}`);
          add(node, node.arguments[0].text, node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'dynamic-import' : 'require', false);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    } else if (file.endsWith('.json')) JSON.parse(bytes.toString('utf8'));
    parsed.set(file, rows); return rows;
  }
  const runtimeSeeds = [resolveFile(path.join(root, 'apps/mobile/index.ts'))];
  if (includeGeneratedInputs) for (const file of ['apps/mobile/src/features/devices/device-stream.browser.ts', 'apps/mobile/src/features/browser/preview-stream.browser.ts']) runtimeSeeds.push(resolveFile(path.join(root, file)));
  const typeSeeds = runtimeSeeds;
  const edges = new Map();
  function traverse(seeds, mode) {
    const files = new Set(), queue = [...seeds];
    while (queue.length) {
      const file = queue.shift(); if (files.has(file)) continue;
      if (files.size >= 10_000) fail('source closure exceeds file limit');
      files.add(file);
      for (const entry of imports(file)) {
        if (mode === 'runtime' && entry.typeOnly) continue;
        const resolved = resolve(entry.specifier, file, mode, entry.kind);
        const edge = { from: relative(file), ...entry, resolutionMode: mode, ...(resolved.file ? { to: relative(resolved.file) } : {}), ...(resolved.workspace ? { workspace: resolved.workspace, exportKey: resolved.exportKey, conditions: resolved.conditions } : {}), ...(resolved.external ? { external: resolved.external } : {}) };
        const fromPackage = owner(file), toPackage = resolved.file ? owner(resolved.file) : null;
        if (fromPackage) edge.fromPackage = fromPackage.name;
        if (toPackage && fromPackage?.name !== toPackage.name) edge.workspace = toPackage.name;
        edges.set(JSON.stringify(edge), edge);
        if (resolved.file) queue.push(resolved.file);
      }
    }
    return files;
  }
  const runtimeFiles = traverse(runtimeSeeds, 'runtime');
  const typeFiles = traverse([...runtimeFiles, ...typeSeeds], 'types');
  const allFiles = [...new Set([...runtimeFiles, ...typeFiles])].sort((a, b) => compare(relative(a), relative(b)));
  const edgeList = [...edges.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const usedPackages = new Set(allFiles.map(owner).filter(Boolean).map(pkg => pkg.name));
  const packageList = [...usedPackages].sort(compare).map(name => {
    const pkg = packages.get(name), ownEdges = edgeList.filter(edge => edge.fromPackage === name);
    return { name, folder: relative(pkg.folder), originalManifest: pkg.originalManifest, manifestSha256: pkg.manifestSha256,
      usedExports: [...pkg.usedExports.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
      dependencies: { workspace: [...new Set(ownEdges.map(edge => edge.workspace).filter(dependency => dependency && dependency !== name))].sort(compare), external: [...new Set(ownEdges.map(edge => edge.external).filter(Boolean))].sort(compare) } };
  });
  return { schema: 1, platform: 'ios', parserVersion: ts.version, limitations: ['External package internals, native autolinking, generated modules and CSS resource imports are not traversed; no Hermes or native-build compatibility claim.'], specialDependencies: { generated: ['@t3tools/mobile-device-stream', '@t3tools/mobile-preview-stream', '@t3tools/mobile-third-party-licenses'], nativeLocal: ['@t3tools/mobile-source-text', '@t3tools/mobile-highlights-native'] }, seeds: runtimeSeeds.map(relative), files: allFiles.map(file => { const bytes = read(file); return { path: relative(file), bytes: bytes.length, sha256: digest(bytes), runtime: runtimeFiles.has(file) }; }), packages: packageList, edges: edgeList, externalNames: [...new Set(edgeList.map(edge => edge.external).filter(Boolean))].sort(compare) };
}
