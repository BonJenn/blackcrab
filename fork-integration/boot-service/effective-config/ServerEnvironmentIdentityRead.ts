/** Exact original persistence error and read-only branch, extracted for private preflight. */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

export class ServerEnvironmentIdPersistenceError extends Schema.TaggedError<ServerEnvironmentIdPersistenceError>()(
  "ServerEnvironmentIdPersistenceError",
  {
    operation: Schema.Literals(["check", "read", "write", "initialize"]),
    environmentIdPath: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    if (this.operation === "initialize") {
      return `Server environment ID file is missing or empty after initialization at '${this.environmentIdPath}'.`;
    }
    return `Server environment ID ${this.operation} failed at '${this.environmentIdPath}'.`;
  }
}

/** Missing/empty returns null; this primitive never initializes or recovers identity. */
export const readExistingEnvironmentId = (environmentIdPath: string) => Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
    const exists = yield* fileSystem.exists(environmentIdPath).pipe(
      Effect.mapError(
        (cause) =>
          new ServerEnvironmentIdPersistenceError({
            operation: "check",
            environmentIdPath: environmentIdPath,
            cause,
          }),
      ),
    );
    if (!exists) {
      return null;
    }

    const raw = yield* fileSystem.readFileString(environmentIdPath).pipe(
      Effect.map((value) => value.trim()),
      Effect.mapError(
        (cause) =>
          new ServerEnvironmentIdPersistenceError({
            operation: "read",
            environmentIdPath: environmentIdPath,
            cause,
          }),
      ),
    );

    return raw.length > 0 ? raw : null;
});
