import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCompilerTools, emittedBinding, compilerSourceFiles, verifyMobileReactCompiler } from './react-compiler.mjs';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Local validation may use a READ-ONLY, already installed native tree. CI and
// native preparation use their own npm-ci workspace. Never install from tests.
const dependencyRoot = process.env.BLACKCRAB_MOBILE_COMPILER_DEPENDENCIES_ROOT ?? repoRoot;
let tools;
const getTools = () => tools ??= loadCompilerTools(repoRoot, dependencyRoot);
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  visit(node); for (const v of Object.values(node)) walk(v, visit);
}
function setterFactory(result) {
  const { declaration, guard, temporary, cached } = emittedBinding(result.ast, 'setRouteOptions');
  const generate = getTools().generate;
  if (!cached) return new Function('$', 'setOptionsByRoute', `return (${generate(declaration.init).code});`);
  return new Function('$', 'setOptionsByRoute', `var ${temporary}; ${generate(guard).code}; ${generate({ type: 'VariableDeclaration', kind: 'var', declarations: [declaration] }).code}; return setRouteOptions;`);
}
test('real Expo production option factory enables pinned React Compiler on all affected original modules', () => {
  const result = verifyMobileReactCompiler({ repoRoot, dependencyRoot });
  assert.equal(result.provenance.pluginVersion, '1.0.0');
  assert.equal(result.files.length, 3);
  assert(result.files.every(f => f.path.startsWith('apps/mobile/.generated/native-ui/apps/mobile/src/')), 'production must transform actual Metro filenames under the owned project');
  assert(result.files.every(f => /^[a-f0-9]{64}$/.test(f.sourceSha256) && /^[a-f0-9]{64}$/.test(f.compiledSha256)));
  const tools = getTools();
  for (const file of compilerSourceFiles) {
    const off = tools.transform(file, false), on = tools.transform(file, true);
    assert.equal(off.metroCompilerFlag, undefined);
    assert.equal(on.metroCompilerFlag, 'true');
    assert.equal(off.code.includes('react.memo_cache_sentinel'), false, file);
    assert.equal(on.code.includes('react.memo_cache_sentinel'), true, file);
    assert.equal(on.sourceSha256, off.sourceSha256, 'compiler must not require changed vendor source');
  }
});
test('actual compiled route setter is stable across renders; disabled production transform reproduces cleanup-triggering identity changes', () => {
  const tools = getTools(), file = compilerSourceFiles[0];
  const on = tools.transform(file, true), off = tools.transform(file, false);
  assert.equal(emittedBinding(on.ast, 'setRouteOptions').cached, true);
  assert.equal(emittedBinding(on.ast, 'isActive').cached, true);
  assert.equal(emittedBinding(off.ast, 'setRouteOptions').cached, false);
  let state = new Map(); const setState = update => { state = update(state); };
  const cache = Array(128).fill(Symbol.for('react.memo_cache_sentinel'));
  const enabled = setterFactory(on), disabled = setterFactory(off);
  const first = enabled(cache, setState), next = enabled(cache, setState);
  assert.equal(first, next, 'header writer dependencies must retain callback identity');
  first('route', { title: 'A' }); next('route', { subtitle: 'B' });
  assert.deepEqual(state.get('route'), { title: 'A', subtitle: 'B' });
  assert.notEqual(disabled([], setState), disabled([], setState), 'disabled transform allocates a new writer every render');
  const source = fs.readFileSync(path.join(repoRoot, 'vendor/t3-mobile/apps/mobile/src/native/StackHeader.tsx'), 'utf8');
  const toolbar = fs.readFileSync(path.join(repoRoot, 'vendor/t3-mobile/apps/mobile/src/native/NativeHeaderToolbar.tsx'), 'utf8');
  assert.match(source, /\[navigation, routeKey, setSlotOptions\]/);
  assert.match(toolbar, /\[setOptions, props\.placement, isTabActive\]/);
});
test('toolbar cleanup emitted by the real compiler is cache guarded; disabled cleanup is freshly allocated', () => {
  const tools = getTools();
  for (const enabled of [false, true]) {
    const result = tools.transform(compilerSourceFiles[2], enabled);
    let cleanupArgument;
    walk(result.ast, n => {
      if (n.type !== 'CallExpression' || n.callee?.name !== 'useLayoutEffect') return;
      const text = tools.generate(n).code;
      if (!enabled && text.includes('unstable_headerRightItems')) cleanupArgument = n.arguments[0];
      if (enabled && n.arguments[0]?.type === 'Identifier') {
        const candidate = n.arguments[0].name;
        walk(result.ast, x => {
          if (x.type === 'AssignmentExpression' && x.left?.name === candidate && tools.generate(x.right).code.includes('unstable_headerRightItems')) cleanupArgument = n.arguments[0];
        });
      }
    });
    assert(cleanupArgument, 'actual cleanup hook must remain present');
    assert.equal(cleanupArgument.type, enabled ? 'Identifier' : 'ArrowFunctionExpression');
    if (enabled) {
      let guardedAllocation = false;
      walk(result.ast, n => {
        if (n.type !== 'IfStatement') return;
        let cacheDependent = false;
        walk(n.test, x => { if (x.type === 'MemberExpression' && x.object?.name === '$') cacheDependent = true; });
        if (!cacheDependent) return;
        walk(n.consequent, x => {
          if (x.type === 'AssignmentExpression' && x.left?.name === cleanupArgument.name && tools.generate(x.right).code.includes('unstable_headerRightItems')) guardedAllocation = true;
        });
      });
      assert.equal(guardedAllocation, true, 'the exact cleanup allocation must be inside a compiler cache-miss branch');
    }
  }
});

test('configuration, published plugin lock, and original source graph fail closed without modifying the installed SDK', async t => {
  const os = await import('node:os');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-compiler-input-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const copy = name => { const to = path.join(fixture, name); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repoRoot, name), to); };
  for (const file of ['package-lock.json', 'apps/mobile/app.json', 'apps/mobile/babel.config.js', 'vendor/t3-mobile/PREPARATION-MANIFEST.json', ...compilerSourceFiles.flatMap(f => [`vendor/t3-mobile/apps/mobile/${f}`, `apps/mobile/.generated/native-ui/apps/mobile/${f}`])]) copy(file);
  const app = JSON.parse(fs.readFileSync(path.join(fixture, 'apps/mobile/app.json')));
  app.expo.experiments.reactCompiler = false;
  fs.writeFileSync(path.join(fixture, 'apps/mobile/app.json'), JSON.stringify(app));
  assert.throws(() => verifyMobileReactCompiler({ repoRoot: fixture, dependencyRoot }), /requires experiments.reactCompiler/);
  app.expo.experiments.reactCompiler = true;
  fs.writeFileSync(path.join(fixture, 'apps/mobile/app.json'), JSON.stringify(app));
  const lockPath = path.join(fixture, 'package-lock.json'), originalLock = fs.readFileSync(lockPath);
  const lock = JSON.parse(originalLock); lock.packages['node_modules/babel-plugin-react-compiler'].integrity = 'changed';
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  assert.throws(() => loadCompilerTools(fixture, dependencyRoot), /pinned 1.0.0 lock/);
  fs.writeFileSync(lockPath, originalLock);
  fs.appendFileSync(path.join(fixture, 'vendor/t3-mobile/apps/mobile', compilerSourceFiles[0]), '\n// source fork\n');
  assert.throws(() => loadCompilerTools(fixture, dependencyRoot).transform(compilerSourceFiles[0], true), /differs from reviewed original/);
  copy(`vendor/t3-mobile/apps/mobile/${compilerSourceFiles[0]}`);
  fs.appendFileSync(path.join(fixture, 'apps/mobile/.generated/native-ui/apps/mobile', compilerSourceFiles[0]), '\n// stale generated source\n');
  assert.throws(() => loadCompilerTools(fixture, dependencyRoot).transform(compilerSourceFiles[0], true), /different prepared source bytes/);
});

test('owned dynamic Expo configuration preserves compiler enablement without executing any upstream config', async () => {
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const ownedCloud = createRequire(import.meta.url)('./activation/adapters/owned-cloud-config.cjs');
  const module = { exports: {} }, calls = [];
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/mobile/app.json'))).expo;
  vm.runInNewContext(fs.readFileSync(path.join(repoRoot, 'apps/mobile/app.config.js'), 'utf8'), {
    module, __dirname: path.join(repoRoot, 'apps/mobile'), process: { env: {}, execPath: process.execPath },
    require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:child_process') return { execFileSync: (...args) => calls.push(args) };
      if (name === '../../mobile-experience/activation/adapters/owned-cloud-config.cjs') return ownedCloud;
      throw new Error('Unexpected dynamic configuration dependency: ' + name);
    },
  });
  const effective = module.exports({ config });
  assert.equal(effective.experiments.reactCompiler, true);
  assert.equal(effective.experiments.typedRoutes, config.experiments.typedRoutes);
  assert.equal(effective.ios.bundleIdentifier, config.ios.bundleIdentifier);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][1], '--ui-only');
});
