import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('./notices/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const MIT_SHA = 'b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5';

/** Some objc2 crates omit the workspace license from their published crate. */
export async function stageRustNotices(packages, output) {
  const registry = JSON.parse(await fs.readFile(path.join(root, 'registry.json'), 'utf8'));
  for (const pkg of packages) {
    if (!pkg.source) continue;
    if (!/^[a-zA-Z0-9_-]+$/.test(pkg.name) || !/^[a-zA-Z0-9.+_-]+$/.test(pkg.version)) throw new Error('Unsafe native dependency metadata');
    const directory = path.dirname(pkg.manifest_path);
    const destination = path.join(output, 'licenses/resource-monitor', `${pkg.name}-${pkg.version}`);
    const files = (await fs.readdir(directory)).filter(name => /^(LICENSE|LICENCE|COPYING|NOTICE)([.-]|$)/i.test(name));
    let copied = 0;
    for (const name of files) {
      const file = path.join(directory, name);
      if (!(await fs.lstat(file)).isFile()) continue;
      await fs.mkdir(destination, { recursive: true }); await fs.copyFile(file, path.join(destination, name)); copied++;
    }
    if (!copied) {
      const record = registry.find(item => item.name === pkg.name && item.version === pkg.version && item.repository === pkg.repository);
      if (!record) throw new Error(`Resource-monitor dependency lacks staged attribution: ${pkg.name}`);
      const vcs = JSON.parse(await fs.readFile(path.join(directory, '.cargo_vcs_info.json'), 'utf8'));
      if (vcs.git?.sha1 !== record.revision || !pkg.license.split(/\s+OR\s+/).includes('MIT')) throw new Error(`Native license source differs: ${pkg.name}`);
      const notice = await fs.readFile(path.join(root, record.file)), mit = await fs.readFile(path.join(root, 'MIT.txt'));
      if (digest(notice) !== record.sha256 || digest(mit) !== MIT_SHA) throw new Error('Vendored native notice digest differs');
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, 'LICENSE.upstream.md'), notice);
      await fs.writeFile(path.join(destination, 'MIT-standard-template.txt'), mit);
      await fs.writeFile(path.join(destination, 'ATTRIBUTION.json'), JSON.stringify({ name: pkg.name, version: pkg.version, authors: pkg.authors, declaredLicense: pkg.license, selectedLicense: 'MIT', source: `https://github.com/madsmtm/objc2/blob/${record.revision}/LICENSE.md`, standardLicenseText: 'https://github.com/spdx/license-list-data/blob/v3.27.0/text/MIT.txt', note: 'The standard MIT template is reproduced unchanged; placeholders are not substituted with invented copyright claims.' }, null, 2));
      await fs.copyFile(pkg.manifest_path, path.join(destination, 'Cargo.toml'));
    }
  }
}
