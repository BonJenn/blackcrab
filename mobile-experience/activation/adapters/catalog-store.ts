import {ConnectionCatalogDocument,EMPTY_CONNECTION_CATALOG_DOCUMENT} from "@t3tools/client-runtime/platform";
import {ConnectionTransientError} from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as MobileSecureStorage from "../persistence/mobile-secure-storage";
import {createCatalogState} from "./owned-catalog-state";
export const CONNECTION_CATALOG_KEY="blackcrab.mobile.managedCatalog.v1";
const codec=Schema.fromJsonString(ConnectionCatalogDocument);
const error=()=>new ConnectionTransientError({reason:"remote-unavailable",detail:"Could not access saved managed environments. Your saved data was preserved."});
export const make=Effect.fn("blackcrab.mobile.catalog.make")(function*(){
 const storage=yield* MobileSecureStorage.MobileSecureStorage;
 const catalog=createCatalogState({getItem:key=>Effect.runPromise(storage.getItem(key)),setItem:(key,raw)=>Effect.runPromise(storage.setItem(key,raw))},{decode:Schema.decodeUnknownSync(codec),encode:Schema.encodeSync(codec),empty:EMPTY_CONNECTION_CATALOG_DOCUMENT},CONNECTION_CATALOG_KEY);
 return {read:Effect.tryPromise({try:catalog.read,catch:error}),update:(transform:Parameters<typeof catalog.update>[0])=>Effect.tryPromise({try:()=>catalog.update(transform),catch:error})};
});
