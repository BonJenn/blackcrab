/** Native presentation models. Host protocol/state schemas remain in the shared runtime. */
export interface ManagedProjectView {
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

export interface ManagedThreadView {
  readonly id: string;
  readonly title: string;
  readonly projectId?: string;
  readonly status: string;
}

export interface ManagedEnvironmentView {
  readonly environmentId: string;
  readonly label: string;
  /** Normalized address without credentials, query parameters or fragments. */
  readonly address: string;
  readonly phase: "disconnected" | "connecting" | "connected" | "offline" | "blocked";
  readonly dataStatus: "empty" | "cached" | "synchronizing" | "live";
  /** A sanitized user-facing error supplied by the connection owner. */
  readonly error?: string;
  readonly projects: readonly ManagedProjectView[];
  readonly threads: readonly ManagedThreadView[];
}

export interface ManagedEnvironmentsSnapshot {
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly selectedEnvironmentId?: string;
  readonly environments: readonly ManagedEnvironmentView[];
}

export interface ManagedEnvironmentsClient {
  readonly retry?: () => Promise<void>;
  readonly getSnapshot: () => ManagedEnvironmentsSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly pair: (input: { address: string; pairingCode: string }) => Promise<void>;
  readonly connect: (environmentId: string) => Promise<void>;
  readonly disconnect: (environmentId: string) => Promise<void>;
  readonly forget: (environmentId: string) => Promise<void>;
  readonly select: (environmentId: string) => Promise<void> | void;
}
