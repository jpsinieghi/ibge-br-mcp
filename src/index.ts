#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

/**
 * Entry point: build the IBGE MCP Server and serve it over STDIO.
 *
 * Server construction lives in `server.ts` (side-effect-free, testable); this
 * file only wires it to the STDIO transport — stdout is the MCP protocol
 * channel, so all logging goes to stderr.
 */
async function main() {
  const server = createServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
