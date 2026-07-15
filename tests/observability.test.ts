import { afterEach, describe, expect, it, vi } from "vitest";
import { metrics, withMetrics } from "../src/metrics.js";
import {
  initializeObservability,
  serializeError,
  summarizeForObservation,
} from "../src/observability.js";

const originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
const originalSecretKey = process.env.LANGFUSE_SECRET_KEY;

afterEach(() => {
  if (originalPublicKey === undefined) delete process.env.LANGFUSE_PUBLIC_KEY;
  else process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey;
  if (originalSecretKey === undefined) delete process.env.LANGFUSE_SECRET_KEY;
  else process.env.LANGFUSE_SECRET_KEY = originalSecretKey;
  vi.restoreAllMocks();
});

describe("Langfuse observability", () => {
  it("redacts credentials and personal identifiers without hiding public municipality names", () => {
    expect(
      summarizeForObservation({
        municipio: "Campinas",
        authorization: "Bearer secret",
        nested: { api_key: "secret", email: "pessoa@example.com" },
      })
    ).toEqual({
      municipio: "Campinas",
      authorization: "[redacted]",
      nested: { api_key: "[redacted]", email: "[redacted]" },
    });
  });

  it("limits large arrays and serializes errors safely", () => {
    const summary = summarizeForObservation(Array.from({ length: 25 }, (_, index) => index));
    expect(summary).toHaveLength(21);
    expect((summary as unknown[])[20]).toBe("...[5 more items]");
    expect(serializeError(new Error("falha"))).toMatchObject({
      name: "Error",
      message: "falha",
    });
  });

  it("stays disabled without credentials and does not block server startup", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      initializeObservability({ serverName: "ibge-br-mcp", serverVersion: "test" })
    ).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("missing_credentials"));
  });

  it("records tool results marked isError as failures", async () => {
    metrics.reset();
    await withMetrics("tool_teste", "sidra", async () => ({ isError: true, markdown: "falha" }));
    expect(metrics.getMetrics()).toMatchObject({
      totalCalls: 1,
      totalFailures: 1,
      byTool: { tool_teste: { failures: 1, errors: { ToolErrorResult: 1 } } },
    });
  });
});
