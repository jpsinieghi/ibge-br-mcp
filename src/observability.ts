import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

import { getObservabilityConfig } from "./config.js";

const MAX_DEPTH = 4;
const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 25;
const SENSITIVE_KEY =
  /(?:authorization|api[_-]?key|secret|token|password|passwd|cpf|cnpj|e-?mail|telefone|phone|endereco|address|birth|nascimento)/iu;

interface ObservationLike {
  update(value: Record<string, unknown>): void;
  startObservation(name: string): ObservationLike;
  end(): void;
}

interface TraceOptions {
  name: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
  sessionId?: string;
  userId?: string;
}

interface ObservationOptions {
  input?: unknown;
  metadata?: Record<string, unknown>;
}

let observabilitySdk: NodeSDK | null = null;
let observabilityEnabled = false;
let serviceMetadata: Record<string, unknown> = {};

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

function summarizeArray(items: unknown[], depth: number): unknown[] {
  const result = items
    .slice(0, MAX_ARRAY_ITEMS)
    .map((item) => summarizeForObservation(item, depth + 1));

  if (items.length > MAX_ARRAY_ITEMS) {
    result.push(`...[${items.length - MAX_ARRAY_ITEMS} more items]`);
  }

  return result;
}

function summarizeObjectEntries(
  entries: Array<[string, unknown]>,
  depth: number
): Record<string, unknown> {
  const limitedEntries = entries.slice(0, MAX_OBJECT_KEYS);
  const result = Object.fromEntries(
    limitedEntries.map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[redacted]" : summarizeForObservation(value, depth + 1),
    ])
  );

  if (entries.length > MAX_OBJECT_KEYS) {
    result.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  }

  return result;
}

export function summarizeForObservation(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth >= MAX_DEPTH) return "[max-depth-reached]";
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return summarizeArray(value, depth);
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "object") return summarizeObjectEntries(Object.entries(value), depth);
  return String(value);
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncateString(error.message),
      stack: truncateString(error.stack ?? ""),
    };
  }

  return {
    name: "UnknownError",
    message: truncateString(String(error)),
  };
}

function createNoopObservation(): ObservationLike {
  return {
    update() {},
    end() {},
    startObservation() {
      return createNoopObservation();
    },
  };
}

function logLifecycle(level: "info" | "error", message: string, details = {}): void {
  console.error(JSON.stringify({ level, message, ...details }));
}

function observationPayload(value: unknown): Record<string, unknown> {
  const summarized = summarizeForObservation(value);
  if (summarized && typeof summarized === "object" && !Array.isArray(summarized)) {
    return summarized as Record<string, unknown>;
  }
  return { value: summarized };
}

function traceMetadata(value: Record<string, unknown>): Record<string, string> {
  const summarized = observationPayload(value);
  return Object.fromEntries(
    Object.entries(summarized).map(([key, item]) => [
      key,
      typeof item === "string" ? item : JSON.stringify(item),
    ])
  );
}

export function isObservabilityEnabled(): boolean {
  return observabilityEnabled;
}

export async function initializeObservability(options: {
  serverName: string;
  serverVersion: string;
}): Promise<boolean> {
  if (observabilitySdk) return observabilityEnabled;

  const config = getObservabilityConfig();
  serviceMetadata = {
    serviceName: options.serverName,
    serviceVersion: options.serverVersion,
    appVersion: config.appVersion,
    environment: config.tracingEnvironment,
  };

  if (!config.publicKey || !config.secretKey) {
    logLifecycle("info", "Langfuse observability disabled", {
      reason: "missing_credentials",
      missing: [
        !config.publicKey ? "LANGFUSE_PUBLIC_KEY" : null,
        !config.secretKey ? "LANGFUSE_SECRET_KEY" : null,
      ].filter(Boolean),
    });
    return false;
  }

  observabilitySdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: config.publicKey,
        secretKey: config.secretKey,
        baseUrl: config.baseUrl,
        environment: config.tracingEnvironment,
      }),
    ],
  });

  await Promise.resolve(observabilitySdk.start());
  observabilityEnabled = true;
  logLifecycle("info", "Langfuse observability enabled", {
    serverName: options.serverName,
    serverVersion: options.serverVersion,
    appVersion: config.appVersion,
    baseUrl: config.baseUrl,
    tracingEnvironment: config.tracingEnvironment,
  });
  return true;
}

export async function shutdownObservability(): Promise<void> {
  if (!observabilitySdk) return;

  await observabilitySdk.shutdown();
  observabilitySdk = null;
  observabilityEnabled = false;
}

export async function withTrace<T>(
  { name, input, metadata = {}, tags = [], sessionId, userId }: TraceOptions,
  callback: (observation: ObservationLike) => Promise<T>
): Promise<T> {
  if (!observabilityEnabled) return callback(createNoopObservation());

  const safeMetadata = observationPayload({ ...serviceMetadata, ...metadata });
  return propagateAttributes(
    {
      traceName: name,
      sessionId,
      userId,
      tags,
      metadata: traceMetadata(safeMetadata),
    },
    async () =>
      startActiveObservation(name, async (observation) => {
        observation.update({
          input: observationPayload(input),
          metadata: safeMetadata,
        });

        try {
          return await callback(observation as ObservationLike);
        } catch (error) {
          observation.update({
            output: { status: "error", error: serializeError(error) },
          });
          throw error;
        }
      })
  );
}

export async function withObservation<T>(
  name: string,
  { input, metadata = {} }: ObservationOptions,
  callback: (observation: ObservationLike) => Promise<T>
): Promise<T> {
  if (!observabilityEnabled) return callback(createNoopObservation());

  const safeMetadata = observationPayload({ ...serviceMetadata, ...metadata });
  return startActiveObservation(name, async (observation) => {
    observation.update({
      input: observationPayload(input),
      metadata: safeMetadata,
    });

    try {
      return await callback(observation as ObservationLike);
    } catch (error) {
      observation.update({
        output: { status: "error", error: serializeError(error) },
      });
      throw error;
    }
  });
}
