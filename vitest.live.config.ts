import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live.integration.test.ts"],
    testTimeout: 30000,
    env: { RUN_IBGE_LIVE_TESTS: "1" },
  },
});
