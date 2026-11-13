import fs from 'node:fs/promises';
import path from 'node:path';

// Check the delivered renderer, including schema-generated provider settings.
// Protocol/storage identifiers and separate upstream license notices stay intact.
const upstreamProduct = /\bT3\s+(?:[Cc]ode|[Cc]hat|[Aa]ccount|[Cc]onnect)\b|https:\/\/github\.com\/apps\/t3-code-for-github\b/;

export async function assertOwnedRendererCopy(root) {
  let filesChecked = 0;
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, {withFileTypes:true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(?:mjs|cjs|js)$/.test(entry.name)) {
        const source = await fs.readFile(file, 'utf8');
        if (upstreamProduct.test(source)) {
          throw Error('Upstream product copy remains in renderer: ' + path.relative(root, file));
        }
        filesChecked++;
      }
    }
  }
  await visit(root);
  if (!filesChecked) throw Error('No renderer JavaScript found for branding validation');
  return {filesChecked};
}
