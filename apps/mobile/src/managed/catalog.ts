// Adapted from BonJenn/t3code 7f02de2 connection/catalog-store.ts.
// Upstream MIT attribution: vendor/t3/LICENSE.upstream.
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
  type ConnectionCatalogDocument as CatalogDocument,
} from "@t3tools/client-runtime/platform";
import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

export const MANAGED_CATALOG_KEY = "blackcrab.mobile.managedCatalog.v1";

export interface ManagedSecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface ManagedCatalog {
  readonly read: Effect.Effect<CatalogDocument, ConnectionTransientError>;
  readonly update: (transform: (catalog: CatalogDocument) => CatalogDocument) => Effect.Effect<void, ConnectionTransientError>;
}
const codec = Schema.fromJsonString(ConnectionCatalogDocument);
const decode = Schema.decodeEffect(codec);
const encode = Schema.encodeEffect(codec);
const storageError = (operation: "load" | "decode" | "encode" | "save") => new ConnectionTransientError({
  reason: "remote-unavailable",
  // Do not include a native error/parse tree: either can contain bearer credentials.
  detail: `Could not ${operation} saved managed environments. Your saved data was preserved.`,
});

/** A catalog is committed as one secure-store value; legacy namespaces are never accessed. */
export const makeManagedCatalog = Effect.fn("blackcrab.managed.makeCatalog")(function* (storage: ManagedSecureStorage) {
  const state = yield* Ref.make<Option.Option<CatalogDocument>>(Option.none());
  const lock = yield* Semaphore.make(1);
  const load = Effect.fn("blackcrab.managed.loadCatalog")(function* () {
    const cached = yield* Ref.get(state);
    if (Option.isSome(cached)) return cached.value;
    const raw = yield* Effect.tryPromise({
      try: () => storage.getItem(MANAGED_CATALOG_KEY),
      catch: () => storageError("load"),
    });
    // Only a missing item means empty. Corrupt/blank content is preserved for recovery.
    const document = raw === null ? EMPTY_CONNECTION_CATALOG_DOCUMENT : yield* decode(raw).pipe(
      Effect.mapError(() => storageError("decode")),
    );
    yield* Ref.set(state, Option.some(document));
    return document;
  });
  const read = lock.withPermits(1)(load());
  const update: ManagedCatalog["update"] = transform => lock.withPermits(1)(Effect.uninterruptible(
    Effect.gen(function* () {
      const current = yield* load();
      const next = yield* Effect.try({ try: () => transform(current), catch: () => storageError("encode") });
      const raw = yield* encode(next).pipe(Effect.mapError(() => storageError("encode")));
      yield* Effect.tryPromise({ try: () => storage.setItem(MANAGED_CATALOG_KEY, raw), catch: () => storageError("save") });
      yield* Ref.set(state, Option.some(next));
    }),
  ));
  return { read, update } satisfies ManagedCatalog;
});
