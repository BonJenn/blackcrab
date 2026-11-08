import { analyzeMobileExperience } from './graph.mjs';

/** Recompute the complete graph; a caller must independently authenticate sourceRoot. */
export function verifyMobileExperienceGraph(sourceRoot, expected) {
  const actual = analyzeMobileExperience(sourceRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Mobile experience graph differs from source, parser or dependency policy');
  }
  return { files: actual.files.length, packages: actual.packages.length, externalNames: actual.externalNames };
}
