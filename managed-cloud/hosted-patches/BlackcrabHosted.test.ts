import { createRequire } from "node:module";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Inspect generated public files synchronously in this Node-only build test.
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { buildHostedChannelSelectionUrl, buildHostedPairingUrl, readHostedPairingRequest, isHostedStaticApp } from "./hostedPairing";
import { config } from "../vercel";
const prepared = JSON.parse(readFileSync(new URL("../../../BLACKCRAB-HOSTED-SOURCE.json", import.meta.url), "utf8"));

afterEach(() => { vi.unstubAllEnvs(); });

test("owned channel links match the deployment selector and retain original pairing fragments", () => {
  vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.blackcrab.example");
  vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "latest");
  vi.stubEnv("VITE_HTTP_URL", ""); vi.stubEnv("VITE_WS_URL", "");
  expect(isHostedStaticApp(new URL("https://app.blackcrab.example"))).toBe(true);
  for (const channel of ["latest", "nightly"] as const) {
    const url = new URL(buildHostedChannelSelectionUrl({ channel }));
    expect(url.origin).toBe("https://app.blackcrab.example");
    expect(url.pathname).toBe("/__blackcrab/channel");
    expect(url.searchParams.get("channel")).toBe(channel);
    expect(config.routes?.some(route => "src" in route && route.src === url.pathname)).toBe(prepared.config.channels !== null);
  }
  const pairing = new URL(buildHostedPairingUrl({ host: "https://agent.example", token: "fixture-pairing", label: "Laptop" }));
  expect(pairing.origin).toBe("https://app.blackcrab.example");
  expect(pairing.searchParams.has("token")).toBe(false);
  expect(pairing.hash).toBe("#token=fixture-pairing");
  expect(readHostedPairingRequest(pairing)).toEqual({ host: "https://agent.example", token: "fixture-pairing", label: "Laptop" });
});

test("the generated project routing passes the pinned Vercel route validator", () => {
  const require = createRequire(import.meta.url);
  const routing = createRequire(require.resolve("@vercel/config/v1"))("@vercel/routing-utils");
  const transformed = routing.getTransformedRoutes({ routes: config.routes });
  expect(transformed.error).toBeNull();
  expect(transformed.routes).toHaveLength(config.routes!.length);
  expect(JSON.stringify(config)).not.toContain("t3.codes");
  expect(config.git?.deploymentEnabled).toBe(false);
});

test("the original hosted static detection also supports a single configured origin", () => {
  vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.blackcrab.example");
  vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "");
  vi.stubEnv("VITE_HTTP_URL", ""); vi.stubEnv("VITE_WS_URL", "");
  expect(isHostedStaticApp(new URL("https://app.blackcrab.example"))).toBe(true);
  expect(isHostedStaticApp(new URL("https://app.t3.codes"))).toBe(false);
  vi.stubEnv("VITE_HTTP_URL", "http://localhost:3773");
  expect(isHostedStaticApp(new URL("https://app.blackcrab.example"))).toBe(false);
});

test("prepared web app metadata names Blackcrab and its owned native bundle", () => {
  const read = (name: string) => JSON.parse(readFileSync(new URL("../public/" + name, import.meta.url), "utf8"));
  expect(read("manifest.webmanifest").name).toBe("Blackcrab");
  const association = read(".well-known/apple-app-site-association.json");
  expect(association.applinks.details[0].appIDs[0]).toMatch(/^[A-Z0-9]{10}\.dev\.blackcrab\.remote$/);
  expect(association.applinks.details[0].components).toEqual([{ "/": "/threads/*" }]);
});

test("production output contains owned service settings and usable Blackcrab setup instructions", () => {
  const assets = new URL("../dist/assets/", import.meta.url);
  const javascript = readdirSync(assets).filter(name => name.endsWith(".js"))
    .map(name => readFileSync(new URL(name, assets), "utf8")).join("\n");
  for (const expected of [prepared.config.hostedAppUrl, prepared.config.cloud.relayUrl,
    prepared.config.cloud.publishableKey, prepared.config.desktopDownloadUrl, prepared.config.privacyPolicyUrl,
    "/__blackcrab/channel", "Open Blackcrab", "Set up Blackcrab"]) expect(javascript).toContain(expected);
  for (const inherited of ["https://app.t3.codes", "https://t3.codes/privacy-policy", "npx t3 connect", "npx t3 pair", "npx t3 serve",
    "__BLACKCRAB_DESKTOP_DOWNLOAD_URL__", "__BLACKCRAB_PRIVACY_POLICY_URL__"]) expect(javascript).not.toContain(inherited);
  expect(readFileSync(new URL("../dist/index.html", import.meta.url), "utf8")).toContain('href="/blackcrab.png"');
  for (const relative of ["blackcrab.png", "apple-touch-icon.png", "manifest.webmanifest",
    ".well-known/apple-app-site-association.json", ".well-known/assetlinks.json"]) {
    expect(readFileSync(new URL("../dist/" + relative, import.meta.url)))
      .toEqual(readFileSync(new URL("../public/" + relative, import.meta.url)));
  }
});
