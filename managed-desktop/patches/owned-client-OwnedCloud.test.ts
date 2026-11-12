import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

const ref = { environmentId: EnvironmentId.make("office"), threadId: ThreadId.make("thread-1") };

it("routes sign-in and shared links to the configured Blackcrab origin", async () => {
  vi.stubGlobal("__BLACKCRAB_HOSTED_APP_URL__", "https://app.blackcrab.example");
  vi.resetModules();
  try {
    const { DEFAULT_HOSTED_APP_URL, buildConnectAuthorizeRequestUrl } =
      await import("./connectAuth.ts");
    const { hostedThreadLink, parseThreadLinkHref, threadLinkRefs } =
      await import("./threadLinks.ts");
    const { buildNewThreadLink, promptLinkAppPath } = await import("./promptLinks.ts");
    expect(
      new URL(
        buildConnectAuthorizeRequestUrl({
          hostedAppUrl: DEFAULT_HOSTED_APP_URL,
          state: "state",
          challenge: "challenge",
          loopbackPort: 34338,
        }),
      ).origin,
    ).toBe("https://app.blackcrab.example");
    const link = hostedThreadLink(ref);
    expect(link).toBe("https://app.blackcrab.example/threads/office/thread-1");
    expect(parseThreadLinkHref(link)).toEqual(ref);
    expect(threadLinkRefs(`See ${link}`, ref.environmentId)).toEqual([ref]);
    expect(promptLinkAppPath(buildNewThreadLink({ prompt: "hello" }))).toBe("/new?prompt=hello");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("accepts only owned hosted and Blackcrab desktop provider callbacks", async () => {
  vi.stubGlobal("__BLACKCRAB_HOSTED_APP_URL__", "https://app.blackcrab.example");
  vi.resetModules();
  try {
    const { providerAuthReturnUrl } = await import("./providerAuthReturnUrl.ts");
    for (const origin of [
      "https://app.blackcrab.example",
      "blackcrab://app",
      "blackcrab-dev://app",
      "http://localhost:4000",
    ]) {
      expect(
        providerAuthReturnUrl(`${origin}/settings/providers?instanceId=work&code=secret`),
      ).toBe(`${origin}/settings/providers?instanceId=work`);
    }
    for (const origin of [
      "https://app.t3.codes",
      "https://app.blackcrab.example.attacker.test",
      "https://attacker.test",
      "t3code://app",
      "blackcrab://other",
      "https://user:pass@app.blackcrab.example",
    ]) {
      expect(providerAuthReturnUrl(`${origin}/welcome`)).toBeUndefined();
    }
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps local thread links usable without inventing a hosted service", async () => {
  vi.stubGlobal("__BLACKCRAB_HOSTED_APP_URL__", "");
  vi.resetModules();
  try {
    const { DEFAULT_HOSTED_APP_URL } = await import("./connectAuth.ts");
    const { hostedThreadLink, parseThreadLinkHref, hasThreadLinks, threadLinkRefs } =
      await import("./threadLinks.ts");
    const { buildNewThreadLink } = await import("./promptLinks.ts");
    const { providerAuthReturnUrl } = await import("./providerAuthReturnUrl.ts");
    expect(DEFAULT_HOSTED_APP_URL).toBe("");
    const local = hostedThreadLink(ref);
    expect(local).toBe("t3-thread://v2/office/thread-1");
    expect(parseThreadLinkHref(local)).toEqual(ref);
    expect(threadLinkRefs(`<${local}>`, ref.environmentId)).toEqual([ref]);
    expect(parseThreadLinkHref("/threads/office/thread-1")).toBeNull();
    expect(hasThreadLinks("/threads/office/thread-1")).toBe(false);
    expect(threadLinkRefs("/threads/office/thread-1", ref.environmentId)).toEqual([]);
    expect(providerAuthReturnUrl("https://app.t3.codes/welcome")).toBeUndefined();
    expect(() => buildNewThreadLink({ prompt: "hello" })).toThrow(/not configured/);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("round-trips pairing, prompt and provider handoffs through the Blackcrab app scheme", async () => {
  vi.stubGlobal("__BLACKCRAB_HOSTED_APP_URL__", "https://app.blackcrab.example");
  vi.resetModules();
  try {
    const { buildPairingAppLink, readPairingAppLink } = await import("./remote.ts");
    const { promptLinkDeepLink, promptLinkAppPath } = await import("./promptLinks.ts");
    const {
      codexAuthHandoffUrl,
      readCodexAuthHandoff,
      codexAuthDeliveryUrl,
      readCodexAuthDelivery,
    } = await import("./codexAuthHandoff.ts");
    const { ProviderInstanceId } = await import("@t3tools/contracts");
    const pairing = "https://machine.blackcrab.example/pair#token=fixture";
    const appPairing = buildPairingAppLink(pairing);
    expect(appPairing.startsWith("blackcrab://pair?")).toBe(true);
    expect(readPairingAppLink(appPairing)).toBe(pairing);
    expect(readPairingAppLink(appPairing.replace("blackcrab:", "t3code:"))).toBeNull();
    const prompt = promptLinkDeepLink("/new?prompt=hello");
    expect(prompt).toBe("blackcrab://new?prompt=hello");
    expect(promptLinkAppPath(prompt)).toBe("/new?prompt=hello");
    const state = "a".repeat(43);
    const auth = new URL("https://auth.openai.com/api/accounts/authorize");
    auth.search = new URLSearchParams({
      client_id: "dynamic_agent_client",
      response_type: "code",
      redirect_uri: "http://127.0.0.1:54213/auth/callback",
      state,
      code_challenge_method: "S256",
      code_challenge: "b".repeat(43),
    }).toString();
    const input = {
      authorizationUrl: auth.toString(),
      returnUrl: "https://app.blackcrab.example/welcome#agents:office",
      environmentId: ref.environmentId,
      instanceId: ProviderInstanceId.make("work"),
      flowId: "fixture-flow",
    };
    const handoff = codexAuthHandoffUrl(input);
    expect(handoff.startsWith("blackcrab://auth/codex?")).toBe(true);
    expect(readCodexAuthHandoff(handoff, false)).toEqual(input);
    expect(readCodexAuthHandoff(handoff, true)).toBeUndefined();
    expect(readCodexAuthHandoff(codexAuthHandoffUrl(input, true), true)).toEqual(input);
    const callback = `http://127.0.0.1:54213/auth/callback?state=${state}&code=disposable-fixture`;
    const delivery = codexAuthDeliveryUrl(input, callback);
    expect(new URL(delivery).origin).toBe("https://app.blackcrab.example");
    expect(new URL(delivery).search).toBe("");
    expect(readCodexAuthDelivery(delivery)?.callbackUrl).toBe(callback);
  } finally {
    vi.unstubAllGlobals();
  }
});
