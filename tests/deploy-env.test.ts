import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("build-cloud-run-env", () => {
  it("loads Langfuse credentials from .env without printing their values", () => {
    const directory = mkdtempSync(join(tmpdir(), "ibge-deploy-env-"));
    tempDirectories.push(directory);
    const envFile = join(directory, ".env");
    const outputFile = join(directory, "cloud-run-env.json");
    writeFileSync(
      envFile,
      "LANGFUSE_PUBLIC_KEY=pk-test-secret\nLANGFUSE_SECRET_KEY=sk-test-secret\n",
      "utf8"
    );

    const stdout = execFileSync(
      process.execPath,
      [
        resolve("scripts/build-cloud-run-env.mjs"),
        "--output",
        outputFile,
        "--env-file",
        envFile,
        "--app-version",
        "dev",
        "--allowed-origin",
        "*",
        "--ibge-timeout-ms",
        "30000",
        "--api-key",
        "",
      ],
      { encoding: "utf8" }
    );
    const generated = JSON.parse(readFileSync(outputFile, "utf8"));

    expect(generated).toMatchObject({
      APP_VERSION: "dev",
      LANGFUSE_PUBLIC_KEY: "pk-test-secret",
      LANGFUSE_SECRET_KEY: "sk-test-secret",
      LANGFUSE_BASE_URL: "https://cloud.langfuse.com",
      LANGFUSE_TRACING_ENVIRONMENT: "dev",
    });
    expect(stdout).not.toContain("pk-test-secret");
    expect(stdout).not.toContain("sk-test-secret");
  });
});
