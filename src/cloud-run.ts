import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { registerAll, SERVER_NAME, SERVER_VERSION } from "./server.js";

const WEBSITE_URL = "https://github.com/SidneyBissoli/ibge-br-mcp";
const PORT = Number(process.env.PORT || "8080");
const HOST = "0.0.0.0";

interface MiddlewareRequest {
  body?: unknown;
  header(name: string): string | undefined;
}

interface MiddlewareResponse {
  headersSent: boolean;
  setHeader(name: string, value: string): void;
  status(code: number): MiddlewareResponse;
  end(): void;
  json(body: unknown): void;
  on(event: "close", listener: () => void): void;
  send(body: string): void;
  type(contentType: string): MiddlewareResponse;
}

type HttpRequest = IncomingMessage & MiddlewareRequest;
type HttpResponse = ServerResponse & MiddlewareResponse;

function buildServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    websiteUrl: WEBSITE_URL,
  });
  registerAll(server);
  return server;
}

let serverCardCache: string | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRpcResult = any;

async function getServerCard(): Promise<string> {
  if (serverCardCache) return serverCardCache;

  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const pending = new Map<number, (msg: JsonRpcResult) => void>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientTransport.onmessage = (msg: any) => {
    const callback = msg && typeof msg.id === "number" ? pending.get(msg.id) : undefined;
    if (callback) {
      callback(msg);
      pending.delete(msg.id);
    }
  };
  await clientTransport.start();

  let nextId = 1;
  const request = (method: string, params?: unknown): Promise<JsonRpcResult> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (msg) =>
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void clientTransport.send({ jsonrpc: "2.0", id, method, params } as any);
    });

  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "server-card-builder", version: SERVER_VERSION },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  void clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" } as any);

  const tools = (await request("tools/list")).tools;
  let resources: unknown[] = [];
  let prompts: unknown[] = [];

  try {
    resources = (await request("resources/list")).resources;
  } catch {
    // Some clients may not request resources.
  }

  try {
    prompts = (await request("prompts/list")).prompts;
  } catch {
    // Some clients may not request prompts.
  }

  await clientTransport.close();
  await server.close();

  serverCardCache = JSON.stringify({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    websiteUrl: WEBSITE_URL,
    protocolVersion: init.protocolVersion,
    capabilities: init.capabilities,
    instructions: init.instructions,
    tools,
    resources,
    prompts,
  });

  return serverCardCache;
}

function setCorsHeaders(
  res: {
    setHeader(name: string, value: string): void;
  },
  origin: string
): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getAllowedOrigin(): string {
  return process.env.ALLOWED_ORIGIN || "*";
}

const app = createMcpExpressApp({ host: HOST });

app.use((_req: MiddlewareRequest, res: MiddlewareResponse, next: () => void) => {
  setCorsHeaders(res, getAllowedOrigin());
  next();
});

app.use((req: MiddlewareRequest & { method?: string }, res: MiddlewareResponse, next: () => void) => {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.get("/health", (_req: MiddlewareRequest, res: MiddlewareResponse) => {
  res.type("text/plain").status(200).send("ok");
});

app.get("/.well-known/mcp/server-card.json", async (_req: MiddlewareRequest, res: MiddlewareResponse) => {
  try {
    res.type("application/json").status(200).send(await getServerCard());
  } catch (error) {
    console.error("server-card generation failed:", error);
    res.status(500).json({ error: "server card unavailable" });
  }
});

app.get("/.well-known/glama.json", (_req: MiddlewareRequest, res: MiddlewareResponse) => {
  res.status(200).json({
    $schema: "https://glama.ai/mcp/schemas/connector.json",
    maintainers: [{ email: "sbissoli76@gmail.com" }],
  });
});

app.all("/mcp", async (req: HttpRequest, res: HttpResponse) => {
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const auth = req.header("Authorization");
    if (auth !== `Bearer ${apiKey}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

app.use((_req: MiddlewareRequest, res: MiddlewareResponse) => {
  res.status(404).type("text/plain").send(`${SERVER_NAME} - MCP endpoint at /mcp`);
});

app.listen(PORT, HOST, () => {
  console.error(`${SERVER_NAME} HTTP listening on ${HOST}:${PORT}`);
});
