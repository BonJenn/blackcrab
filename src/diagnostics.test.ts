import { describe, expect, it } from "vitest";
import { buildDiagnosticsReport, redactDiagnosticText } from "./diagnostics";

const base = {
  rows: [["app", "0.2.0"]] as Array<[string, string]>,
  authAttention: "(none)",
  activeTitle: "Demo",
  activeCwd: "/tmp/demo",
  userAgent: "test-agent",
  activityCounts: { idle: 2 },
  latestStderr: [],
  recentFailures: [],
};

describe("buildDiagnosticsReport", () => {
  it("renders a recent-errors section with the provided failures", () => {
    const report = buildDiagnosticsReport({
      ...base,
      recentFailures: ["13:45:09  send_message — channel closed"],
    });
    expect(report).toContain("recent errors:");
    expect(report).toContain("send_message — channel closed");
  });

  it("shows (none) when there are no failures", () => {
    const report = buildDiagnosticsReport(base);
    expect(report).toMatch(/recent errors:\n\(none\)/);
  });

  it("redacts secrets that appear inside an error detail", () => {
    const report = buildDiagnosticsReport({
      ...base,
      recentFailures: ["13:00:00  auth — token sk-ant-abc123DEF456 rejected"],
    });
    expect(report).not.toContain("sk-ant-abc123DEF456");
    expect(report).toContain("sk-ant-[redacted]");
  });
});

describe("redactDiagnosticText", () => {
  it("scrubs sk-ant tokens and known secret env assignments", () => {
    expect(redactDiagnosticText("key sk-ant-XYZ_123")).toBe(
      "key sk-ant-[redacted]",
    );
    expect(redactDiagnosticText("ANTHROPIC_API_KEY=supersecret")).toBe(
      "ANTHROPIC_API_KEY=[redacted]",
    );
  });
});
