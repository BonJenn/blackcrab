/** Preserve the pinned mobile source's required React Compiler semantics. No source rewrites. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const policy = JSON.parse(fs.readFileSync(new URL('./react-compiler-policy.json', import.meta.url)));
const pluginIntegrity = 'sha512-Ixm8tFfoKKIPYdCCKYTsqv+Fd4IJ0DQqMyEimo+pxUOMUR9cVPlwTrFt9Avu+3cb6Zp3mAzl+t1MrG2fxxKsxw==';
export const compilerSourceFiles = [
  'src/features/layout/workspace/WorkspaceNativeTabs.ios.tsx',
  'src/native/StackHeader.tsx',
  'src/native/NativeHeaderToolbar.tsx',
];
function walk(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit, ancestors); return; }
  visit(node, ancestors);
  for (const value of Object.values(node)) walk(value, visit, [...ancestors, node]);
}
function cacheGuard(node) {
  let found = false;
  walk(node.test, n => { if (n.type === 'MemberExpression' && n.object?.name === '$') found = true; });
  return found;
}
/** Inspect actual emitted AST, retaining the actual allocation and cache guard for behavioral tests. */
export function emittedBinding(ast, name) {
  let declaration;
  walk(ast, n => { if (n.type === 'VariableDeclarator' && n.id?.name === name) declaration = n; });
  if (!declaration) throw new Error(`Compiler output lacks ${name}.`);
  const temporary = declaration.init?.type === 'Identifier' ? declaration.init.name : null;
  let guard;
  if (temporary) walk(ast, n => {
    if (n.type !== 'IfStatement' || !cacheGuard(n)) return;
    walk(n.consequent, x => { if (x.type === 'AssignmentExpression' && x.left?.name === temporary && /FunctionExpression$/.test(x.right?.type ?? '')) guard = n; });
  });
  return { declaration, guard, cached: Boolean(guard), temporary };
}
export function loadCompilerTools(repoRoot, dependencyRoot = repoRoot) {
  repoRoot = fs.realpathSync(repoRoot); dependencyRoot = fs.realpathSync(dependencyRoot);
  const upstream = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vendor/t3-mobile/PREPARATION-MANIFEST.json'))).upstream;
  if (JSON.stringify(upstream) !== JSON.stringify(policy.upstream)) throw new Error('React Compiler source policy requires the reviewed pinned upstream.');
  const sourceMobile = path.join(repoRoot, 'apps/mobile');
  const dependencyMobile = path.join(dependencyRoot, 'apps/mobile');
  const mobile = dependencyMobile;
  const require = createRequire(path.join(dependencyMobile, 'package.json'));
  const packageFile = require.resolve('babel-plugin-react-compiler/package.json');
  const pkg = JSON.parse(fs.readFileSync(packageFile));
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json')));
  const pin = lock.packages['node_modules/babel-plugin-react-compiler'];
  if (pkg.version !== '1.0.0' || pin?.version !== pkg.version || pin.integrity !== pluginIntegrity) throw new Error('React Compiler dependency must match the pinned 1.0.0 lock record.');
  const rootBabel = fs.readFileSync(path.join(repoRoot, 'apps/mobile/babel.config.js'));
  if (!rootBabel.equals(fs.readFileSync(path.join(dependencyMobile, 'babel.config.js')))) throw new Error('Isolated compiler dependency tree uses different owned Babel configuration.');
  const metroRoot = path.dirname(require.resolve('@expo/metro-config/package.json'));
  const cliRoot = path.dirname(require.resolve('@expo/cli/package.json'));
  const transformer = require(path.join(metroRoot, 'build/babel-transformer.js'));
  const metroOptions = require(path.join(cliRoot, 'build/src/start/server/middleware/metroOptions.js'));
  const dependencyRecords = ['babel-plugin-react-compiler', '@expo/cli', '@expo/metro-config', 'babel-preset-expo', '@babel/core'].map(name => {
    const manifestFile = require.resolve(name + '/package.json');
    const installed = JSON.parse(fs.readFileSync(manifestFile));
    const location = path.relative(dependencyRoot, fs.realpathSync(path.dirname(manifestFile))).split(path.sep).join('/');
    const expected = lock.packages[location];
    if (location.startsWith('../') || !expected?.integrity || expected.version !== installed.version) throw new Error(`Native compiler dependency differs from its owned lock: ${name}`);
    return { name, location, version: installed.version, integrity: expected.integrity, manifestSha256: sha(fs.readFileSync(manifestFile)) };
  });
  const generate = require('@babel/generator').default;
  const expo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/mobile/app.json'))).expo;
  const dependencyFiles = [packageFile, require.resolve('babel-plugin-react-compiler'), path.join(metroRoot, 'build/babel-transformer.js'), path.join(cliRoot, 'build/src/start/server/middleware/metroOptions.js')];
  return {
    expo, generate,
    provenance: { upstream: policy.upstream, upstreamConfigurationEvidence: policy.upstreamConfigurationEvidence, pluginVersion: pkg.version, pluginIntegrity: pin.integrity, dependencyRecords, actualFiles: dependencyFiles.map(file => ({ path: path.relative(dependencyRoot, file).split(path.sep).join('/'), sha256: sha(fs.readFileSync(file)) })) },
    transform(relative, enabled) {
      const original = path.join(repoRoot, 'vendor/t3-mobile/apps/mobile', relative);
      const sourceFile = path.join(sourceMobile, '.generated/native-ui/apps/mobile', relative);
      const filename = path.join(mobile, '.generated/native-ui/apps/mobile', relative);
      if (!fs.lstatSync(original).isFile() || sha(fs.readFileSync(original)) !== policy.sourceSha256[relative]) throw new Error(`React Compiler source differs from reviewed original: ${relative}`);
      if (!fs.lstatSync(sourceFile).isFile() || !fs.lstatSync(filename).isFile()) throw new Error('React Compiler inputs must be original regular source files.');
      const src = fs.readFileSync(sourceFile, 'utf8');
      if (sha(fs.readFileSync(filename)) !== sha(src)) throw new Error('Read-only native compiler dependency tree has different prepared source bytes.');
      if (sha(src) !== policy.sourceSha256[relative]) throw new Error(`React Compiler source differs from reviewed original: ${relative}`);
      // The real Expo export option factory and Babel transformer carry the flag;
      // this does not fake supportsReactCompiler in a hand-written Babel caller.
      const options = metroOptions.getMetroDirectBundleOptionsForExpoConfig(mobile, { ...expo, experiments: { ...expo.experiments, reactCompiler: enabled } }, { mode: 'production', platform: 'ios', engine: 'hermes', mainModuleName: 'index', isExporting: true });
      const result = transformer.transform({ filename, src, options: { ...options, projectRoot: mobile, enableBabelRCLookup: true, extendsBabelConfigPath: path.join(dependencyMobile, 'babel.config.js'), experimentalImportSupport: true }, plugins: [] });
      return { filename: path.relative(dependencyRoot, filename).split(path.sep).join('/'), metroFilenameUnderProject: filename.startsWith(mobile + path.sep), ast: result.ast, code: generate(result.ast).code, sourceSha256: sha(src), metroCompilerFlag: options.customTransformOptions.reactCompiler };
    },
  };
}
export function verifyMobileReactCompiler({ repoRoot, dependencyRoot = repoRoot }) {
  const tools = loadCompilerTools(repoRoot, dependencyRoot);
  if (tools.expo.experiments?.reactCompiler !== true) throw new Error('Pinned mobile UI requires experiments.reactCompiler=true.');
  const files = compilerSourceFiles.map(file => {
    const result = tools.transform(file, tools.expo.experiments.reactCompiler);
    if (!result.metroFilenameUnderProject || result.metroCompilerFlag !== 'true' || !result.code.includes('react.memo_cache_sentinel')) throw new Error(`React Compiler did not memoize ${file}.`);
    if (file.endsWith('WorkspaceNativeTabs.ios.tsx')) for (const name of ['setRouteOptions', 'isActive']) {
      if (!emittedBinding(result.ast, name).cached) throw new Error(`React Compiler did not cache ${name}.`);
    }
    return { path: result.filename, originalPath: `vendor/t3-mobile/apps/mobile/${file}`, sourceSha256: result.sourceSha256, compiledSha256: sha(result.code) };
  });
  return { target: 'ios-production-hermes', enabled: true, provenance: tools.provenance, files };
}
