export interface OwnedCloudConfig {
  readonly version: 1;
  readonly publishableKey: string;
  readonly jwtTemplate: string;
  readonly relayUrl: string;
  readonly hostedAppUrl?: string;
}
export function cloudConfigFromEnvironment(environment: Readonly<Record<string, unknown>>): OwnedCloudConfig | null;
export function resolveOwnedCloudConfig(extra: unknown): OwnedCloudConfig | null;
export function configureOwnedCloud(config: Record<string, unknown>, environment: Readonly<Record<string, unknown>>): Record<string, unknown>;
