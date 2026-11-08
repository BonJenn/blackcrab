import fs from 'node:fs';
import { analyzeMobileExperience } from './graph.mjs';
import { verifyMobileExperienceGraph } from './verify.mjs';
const [mode, sourceRoot, output, ...extra] = process.argv.slice(2);
if (!['write', 'verify'].includes(mode) || !sourceRoot || !output || extra.length) {
  throw new Error('Usage: node mobile-experience/snapshot.mjs <write|verify> <authenticated-source-root> <graph.json>');
}
if (mode === 'write') {
  const graph = analyzeMobileExperience(sourceRoot);
  fs.writeFileSync(output, JSON.stringify(graph, null, 2) + '\n', {flag:'wx'});
  console.log(`Recorded ${graph.files.length} files and ${graph.packages.length} package manifests`);
} else {
  const result = verifyMobileExperienceGraph(sourceRoot, JSON.parse(fs.readFileSync(output, 'utf8')));
  console.log(`Verified ${result.files} files and ${result.packages} package manifests`);
}
