#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { initializeObservability, shutdownObservability } from "./observability.js";

/**
 * Entry point: build the IBGE MCP Server and serve it over STDIO.
 *
 * Server construction lives in `server.ts` (side-effect-free, testable); this
 * file only wires it to the STDIO transport — stdout is the MCP protocol
 * channel, so all logging goes to stderr.
 */
async function main() {
  await initializeObservability({ serverName: SERVER_NAME, serverVersion: SERVER_VERSION });
  const server = createServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`${SERVER_NAME} shutting down (${signal})`);
    await server.close();
    await shutdownObservability();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await shutdownObservability().catch(() => undefined);
  process.exit(1);
});
