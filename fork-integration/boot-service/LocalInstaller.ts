/** Staged at apps/server/src/cloud/BlackcrabLocalInstaller.ts only after profile review. */
import * as Effect from 'effect/Effect';
import {PinnedRuntimeInstallError,type ensurePinnedRuntimeInstalled} from './pinnedRuntime.ts';
type Paths={versionDir:string;entryPath:string;sentinelPath:string};

/** Native-private port performs verified staging, exclusive lease and no-overwrite publication.
 * Validate the staged executable BEFORE publishing its final completion marker or OS unit.
 * No HTTP/release argument is read. release() only cleans its own unpublished staging.
 */
export function makeVerifiedLocalInstaller(binding: {
  baseDir:string;version:string;platform:NodeJS.Platform;arch:string;paths:Paths;
  prepare:()=>Promise<{paths:Paths;commit:()=>Promise<void>;release:()=>Promise<void>}>;
}): typeof ensurePinnedRuntimeInstalled {
  const expected={baseDir:binding.baseDir,version:binding.version,platform:binding.platform,arch:binding.arch};
  const paths={...binding.paths},prepare=binding.prepare;
  return input => Effect.gen(function* () {
    if(input.requirePublishedRelease===true)
      return yield* new PinnedRuntimeInstallError({step:'checking unavailable owned release publication'});
    if(input.baseDir!==expected.baseDir||input.version!==expected.version||input.platform!==expected.platform||input.arch!==expected.arch)
      return yield* new PinnedRuntimeInstallError({step:'matching the captured local Blackcrab runtime'});
    const transaction=yield* Effect.tryPromise({try:()=>prepare(),catch:cause=>new PinnedRuntimeInstallError({step:'staging the verified local Blackcrab runtime',cause})});
    const stagedPaths={...transaction.paths},commit=transaction.commit,release=transaction.release;
    return yield* Effect.gen(function* () {
      yield* input.validate(stagedPaths);
      yield* Effect.tryPromise({try:()=>commit(),catch:cause=>new PinnedRuntimeInstallError({step:'publishing the verified local Blackcrab runtime',cause})});
      return {...paths};
    }).pipe(Effect.ensuring(Effect.tryPromise({try:()=>release(),catch:cause=>cause}).pipe(Effect.ignore)));
  });
}
