import { describe, expect, it } from "vitest";
import { compileMarkdown, githubPullUrl } from "./markdown";

describe("githubPullUrl", () => {
  it("builds canonical GitHub pull request links", () => {
    expect(githubPullUrl("BonJenn/blackcrab", "123")).toBe(
      "https://github.com/BonJenn/blackcrab/pull/123",
    );
  });

  it("rejects malformed repos and pull numbers", () => {
    expect(githubPullUrl("BonJenn/blackcrab/extra", "123")).toBeNull();
    expect(githubPullUrl("BonJenn/../blackcrab", "123")).toBeNull();
    expect(githubPullUrl("javascript:alert(1)/blackcrab", "123")).toBeNull();
    expect(githubPullUrl("BonJenn/blackcrab", "0")).toBeNull();
  });
});

describe("compileMarkdown", () => {
  it("sanitizes unsafe markdown links", () => {
    const html = compileMarkdown("[bad](javascript:alert(1))");

    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:");
  });

  it("linkifies PR references only for valid repositories", () => {
    expect(compileMarkdown("see PR #123", "BonJenn/blackcrab")).toContain(
      'href="https://github.com/BonJenn/blackcrab/pull/123"',
    );

    const invalid = compileMarkdown("see PR #123", "BonJenn/blackcrab/extra");
    expect(invalid).toContain("PR #123");
    expect(invalid).not.toContain("github.com/BonJenn/blackcrab/extra");
  });

  it("does not linkify PR references inside code", () => {
    const html = compileMarkdown("`PR #123`", "BonJenn/blackcrab");

    expect(html).toContain("PR #123");
    expect(html).not.toContain("/pull/123");
  });
});
