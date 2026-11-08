import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** Record exact downloaded C/Swift/framework inputs, not a bit-reproducibility claim. */
export async function collectNativeAssetInputs(repoRoot) {
  repoRoot=await fs.realpath(repoRoot);
  const require = createRequire(path.join(repoRoot, 'apps/mobile/package.json'));
  const packageRoot = path.dirname(require.resolve('react-native-enriched-markdown/package.json'));
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.version !== '1.2.0-t3.16') throw new Error('Unexpected native Markdown package version');
  const ratexBytes = await fs.readFile(path.join(packageRoot, 'ratex-version.json'));
  const grammarBytes = await fs.readFile(path.join(packageRoot, 'cpp/highlight/grammar-versions.json'));
  const ratex = JSON.parse(ratexBytes), grammars = JSON.parse(grammarBytes);
  const files = [];
  async function walk(relative) {
    const full = path.join(packageRoot, relative), stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) throw new Error('Native downloaded input is a symlink');
    if (stat.isDirectory()) for (const child of (await fs.readdir(full)).sort()) await walk(relative + '/' + child);
    else if (stat.isFile()) {
      const bytes = await fs.readFile(full);
      files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
    } else throw new Error('Unsupported native downloaded input');
  }
  await walk('cpp/highlight/vendor'); await walk('ios/vendor');
  if (!files.some(f => f.path.includes('RaTeX.xcframework/')) || !files.some(f => f.path.includes('grammars/'))) throw new Error('Native grammar/math assets are missing');
  const missingDefaults=Object.entries(grammars.grammars).filter(([language,spec])=>spec.default&&!files.some(file=>file.path.startsWith('cpp/highlight/vendor/grammars/'+language+'/'))).map(([language])=>language);
  if(missingDefaults.length)throw new Error('Missing default native grammars: '+missingDefaults.join(', '));
  const grammarDownloads = Object.entries(grammars.grammars).map(([language, spec]) => ({
    language, package: spec.package, version: spec.version,
    url: `https://registry.npmjs.org/${spec.package}/-/${spec.package.split('/').at(-1)}-${spec.version}.tgz`,
  })).filter(item=>files.some(file=>file.path.startsWith('cpp/highlight/vendor/grammars/'+item.language+'/')));
  const fonts=[];for(const file of ['400Regular/DMSans_400Regular.ttf','500Medium/DMSans_500Medium.ttf','700Bold/DMSans_700Bold.ttf']){const resolved=await fs.realpath(require.resolve('@expo-google-fonts/dm-sans/'+file));if(!resolved.startsWith(await fs.realpath(repoRoot)+path.sep))throw new Error('Native font escapes staging');const bytes=await fs.readFile(resolved);fonts.push({path:path.relative(repoRoot,resolved).split(path.sep).join('/'),bytes:bytes.length,sha256:hash(bytes)});}
  return { schema: 1, kind: 'blackcrab-mobile-native-downloaded-inputs', package: manifest.name, version: manifest.version,
    ratexManifestSha256: hash(ratexBytes), grammarManifestSha256: hash(grammarBytes), ratex, grammarRuntime: grammars.runtime, grammarDownloads, fonts, files };
}
