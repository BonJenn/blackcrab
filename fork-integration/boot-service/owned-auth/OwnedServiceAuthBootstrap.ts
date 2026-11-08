// Private candidate only. No public CLI flag/HTTP route. Upstream MIT license adjacent.
import * as FS from "node:fs";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { validOwnedServiceBinding } from "./cloud/serviceProtocol.ts";

export const OwnedServiceBinding = Schema.Struct({
  profile: Schema.Literal("blackcrab-local-service-layout-v1"),
  generation: Schema.Number,
  manifestSha256: Schema.String,
  environmentId: Schema.String,
});
export type OwnedServiceBinding = typeof OwnedServiceBinding.Type;
export const OwnedServiceAuthBootstrap = Schema.Struct({
  schema: Schema.Literal(1),
  kind: Schema.Literal("blackcrab-owned-service-auth-v1"),
  binding: OwnedServiceBinding,
  desktopBootstrapToken: Schema.String,
  desktopBootstrapSecret: Schema.String,
  desktopBrowserFd: Schema.optionalKey(Schema.Number),
  desktopBrowserControlFd: Schema.optionalKey(Schema.Number),
});
export type OwnedServiceAuthBootstrap = typeof OwnedServiceAuthBootstrap.Type;

export const readOwnedServiceAuthBootstrap = (binding: OwnedServiceBinding) => Effect.gen(function* () {
  // Only invoked after real IPC/context selection. FD3 remains the original Node IPC.
  const bytes = yield* Effect.tryPromise({try: () => new Promise<Buffer>((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const input = FS.createReadStream("", {fd: 0, autoClose: false});
    const finish = (error?: Error) => { clearTimeout(timer); input.removeAllListeners(); input.destroy();
      if (error) reject(error); else resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(() => finish(Error("owned-auth-unavailable")), 1000);
    input.on("data", (raw: string | Buffer) => {const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); size += chunk.length; if (size > 16384) finish(Error("owned-auth-unavailable")); else chunks.push(chunk);});
    input.once("error", () => finish(Error("owned-auth-unavailable")));
    input.once("end", () => finish());
  }), catch: () => Error("owned-auth-unavailable")});
  const raw = yield* Effect.try({try: () => JSON.parse(bytes.toString("utf8")), catch: () => Error("owned-auth-unavailable")});
  const auth = yield* Schema.decodeUnknownEffect(OwnedServiceAuthBootstrap, {onExcessProperty: "error"})(raw).pipe(Effect.mapError(() => Error("owned-auth-unavailable")));
  if (!validOwnedServiceBinding(auth.binding) || Object.keys(binding).some(k => binding[k as keyof OwnedServiceBinding] !== auth.binding[k as keyof OwnedServiceBinding]) ||
      !auth.desktopBootstrapToken || auth.desktopBootstrapToken.length > 1024 || !auth.desktopBootstrapSecret || auth.desktopBootstrapSecret.length > 1024 ||
      ((auth.desktopBrowserFd === undefined) !== (auth.desktopBrowserControlFd === undefined)) ||
      [auth.desktopBrowserFd, auth.desktopBrowserControlFd].some(fd => fd !== undefined && (!Number.isSafeInteger(fd) || fd < 5)))
    return yield* Effect.fail(Error("owned-auth-unavailable"));
  return auth;
});
