// @effect-diagnostics nodeBuiltinImport:off -- The test checks synchronous token storage before Electron startup.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodePathLayer from "@effect/platform-node/NodePath";
import * as FileSystem from "effect/FileSystem";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

vi.mock("electron", () => ({ app: {} }));

const mocks = vi.hoisted(() => ({ bridge: vi.fn(), storage: vi.fn() }));
vi.mock("@clerk/electron", () => ({ createClerkBridge: mocks.bridge }));
vi.mock("@clerk/electron/storage", () => ({ storage: mocks.storage }));

it.each([true, false])(
  "initializes original account storage only when configured (%s)",
  async (configured) => {
    vi.stubGlobal(
      "__T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__",
      configured ? "pk_test_Y2xlcmsuYmxhY2tjcmFiLmV4YW1wbGUk" : "",
    );
    vi.resetModules();
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "blackcrab-cloud-token-test-"));
    const tokens = new Map<string, string>();
    mocks.storage.mockReset().mockReturnValue({
      getItem: (key: string) => tokens.get(key) ?? null,
      setItem: (key: string, value: string) => {
        tokens.set(key, value);
      },
      removeItem: (key: string) => {
        tokens.delete(key);
      },
    });
    const cleanup = vi.fn();
    mocks.bridge.mockReset().mockReturnValue({ cleanup });
    try {
      const clerk = await import("./DesktopClerk.ts");
      const environment = DesktopEnvironment.DesktopEnvironment.of({
        stateDir: root,
        isDevelopment: false,
        appDataDirectory: root,
        platform: "darwin",
      } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);
      const app = {
        setPath: () => Effect.void,
        requestSingleInstanceLock: Effect.succeed(true),
        quit: Effect.void,
        on: () => Effect.void,
      } as unknown as ElectronApp.ElectronApp["Service"];
      // oxlint-disable-next-line t3code/no-manual-effect-runtime-in-tests -- Synchronous startup is the behavior under test.
      Effect.runSync(
        Effect.scoped(
          Layer.build(
            clerk.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  NodePathLayer.layerPosix,
                  FileSystem.layerNoop({ exists: () => Effect.succeed(false) }),
                  Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
                  Layer.succeed(ElectronApp.ElectronApp, app),
                  Layer.succeed(ElectronShell.ElectronShell, {
                    openExternal: () => Effect.succeed(true),
                    openSystemSettings: () => Effect.succeed(false),
                    copyText: () => Effect.void,
                  }),
                ),
              ),
            ),
          ),
        ),
      );
      const options = mocks.bridge.mock.calls[0]![0];
      expect(options.manageSingleInstanceLock).toBe(false);
      expect(cleanup).toHaveBeenCalledOnce();
      if (configured) {
        expect(options.passkeys).toBe(true);
        expect(options.renderer).toEqual({ scheme: "blackcrab", host: "app" });
        expect(mocks.storage).toHaveBeenCalledWith({ path: NodePath.join(root, "clerk") });
        await options.storage.setItem("token", "disposable-fixture");
        expect(await options.storage.getItem("token")).toBe("disposable-fixture");
        await options.storage.removeItem("token");
        expect(await options.storage.getItem("token")).toBeNull();
        expect(NodeFS.statSync(NodePath.join(root, "clerk")).mode & 0o777).toBe(0o700);
      } else {
        expect(options.passkeys).toBe(false);
        expect(options.renderer).toBeUndefined();
        expect(mocks.storage).not.toHaveBeenCalled();
        expect(NodeFS.existsSync(NodePath.join(root, "clerk"))).toBe(false);
        expect(() => options.storage.setItem("token", "unused")).toThrow(/not configured/);
      }
    } finally {
      vi.unstubAllGlobals();
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);
