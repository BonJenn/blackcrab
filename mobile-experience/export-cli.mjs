import { buildMobileExperience, verifyExperienceExport } from './export.mjs';
const [mode, ...args] = process.argv.slice(2);
if (mode === 'build' && args.length === 3) {
  console.log(JSON.stringify(await buildMobileExperience({archive:args[0],cacheDir:args[1],output:args[2]}),null,2));
} else if (mode === 'verify' && args.length === 1) {
  console.log(JSON.stringify(await verifyExperienceExport(args[0]),null,2));
} else {
  throw new Error('Usage: node mobile-experience/export-cli.mjs build <pinned-archive> <cache-dir> <absent-output> | verify <output>');
}
