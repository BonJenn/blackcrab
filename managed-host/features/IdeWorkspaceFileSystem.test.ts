// Test service composition follows the pinned MIT-licensed WorkspaceFileSystem.test.ts harness.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
const layerKnown = Layer.mock(KnownWorkspaces.KnownWorkspaces)({ assertContains: () => Effect.void });
const layerProject = WorkspaceFileSystem.layer.pipe(Layer.provide(layerKnown),Layer.provide(WorkspacePaths.layer),Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))));
const layerTest = Layer.empty.pipe(
  Layer.provideMerge(layerProject),
  Layer.provideMerge(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provideMerge(ServerConfig.ServerConfig.layerTest(process.cwd(),{prefix:"blackcrab-ide-test-"})),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer,NodeCrypto.layer)),
);
it.layer(layerTest,{excludeTestServices:true})("IDE host file protocol",it=>{
  it.effect("advertises guarded writes, saves through the real service, and rejects stale content",()=>Effect.gen(function*(){
    const service=yield* WorkspaceFileSystem.WorkspaceFileSystem;
    const fs=yield* FileSystem.FileSystem;const path=yield* Path.Path;
    const cwd=yield* fs.makeTempDirectoryScoped({prefix:"blackcrab-ide-files-"});
    const file=path.join(cwd,"code.ts");yield* fs.writeFileString(file,"original");
    const read=yield* service.readFile({cwd,relativePath:"code.ts",ideGuardedRead:true});expect(read.ideSafeWrite).toBe(true);
    const saved=yield* service.writeFile({cwd,relativePath:"code.ts",contents:"user",ideExpectedContents:read.contents});
    expect(saved.ideConflict).toBe(false);expect(saved.ideRecoveryPath).toBeDefined();
    expect(yield* fs.readFileString(saved.ideRecoveryPath!)).toBe("original");
    const conflict=yield* service.writeFile({cwd,relativePath:"code.ts",contents:"stale",ideExpectedContents:read.contents});
    expect(conflict.ideConflict).toBe(true);expect(yield* fs.readFileString(file)).toBe("user");
    const escape=yield* service.writeFile({cwd,relativePath:"../escape.ts",contents:"bad",ideExpectedContents:""}).pipe(Effect.exit);
    expect(escape._tag).toBe("Failure");
  }));
});
