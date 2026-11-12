// Owned service only; the original direct/desktop watcher remains unchanged.
import * as Effect from "effect/Effect";
export function withOwnedServiceLauncherLifetime<A, E, R>(run: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.scoped(Effect.gen(function* () {
        // Acquire before running any server/listener effect, including web/headless mode.
        const watch = yield* Effect.acquireRelease(Effect.sync(() => {
            let settle!: () => void;
            const promise = new Promise<void>(resolve => { settle = resolve; });
            const listener = () => settle();
            process.once("disconnect", listener);
            const connected = process.connected === true && typeof process.send === "function";
            if (!connected)
                settle();
            return { promise, listener, connected };
        }), watch => Effect.sync(() => { process.off("disconnect", watch.listener); }));
        if (!watch.connected || process.connected !== true)
            return yield* Effect.interrupt;
        return yield* Effect.raceFirst(run, Effect.promise(() => watch.promise).pipe(Effect.andThen(Effect.interrupt)));
    }));
}
