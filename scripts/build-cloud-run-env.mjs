import fs from "node:fs";
import path from "node:path";

const DEPLOY_ENV_NAMES = [
  "APP_VERSION",
  "ALLOWED_ORIGIN",
  "IBGE_MCP_TIMEOUT_MS",
  "API_KEY",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_TRACING_ENVIRONMENT",
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--")) throw new Error(`Argumento invalido: ${key ?? "<ausente>"}`);
    if (value === undefined && key !== "--api-key") {
      throw new Error(`Valor ausente para o argumento: ${key}`);
    }
    args[key.slice(2)] = value ?? "";
  }
  return args;
}

function parseDotEnv(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;

    const [, name, rawValue] = match;
    let value = rawValue.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/u, "").trim();
    }
    values[name] = value;
  }
  return values;
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

const args = parseArgs(process.argv.slice(2));
if (!args.output) throw new Error("Informe --output.");

const envFile = path.resolve(args["env-file"] || ".env");
const dotEnv = fs.existsSync(envFile) ? parseDotEnv(fs.readFileSync(envFile, "utf8")) : {};
const defaults = {
  ALLOWED_ORIGIN: "*",
  IBGE_MCP_TIMEOUT_MS: "30000",
  LANGFUSE_BASE_URL: "https://cloud.langfuse.com",
  LANGFUSE_TRACING_ENVIRONMENT: args["app-version"] || "default",
};
const computed = {
  APP_VERSION: args["app-version"],
  ALLOWED_ORIGIN: args["allowed-origin"],
  IBGE_MCP_TIMEOUT_MS: args["ibge-timeout-ms"],
  API_KEY: args["api-key"],
};

const deployEnv = {};
for (const name of DEPLOY_ENV_NAMES) {
  const dotEnvValue = name === "API_KEY" ? undefined : dotEnv[name];
  const value = firstNonEmpty(computed[name], process.env[name], dotEnvValue, defaults[name]);
  if (value !== undefined) deployEnv[name] = value;
}

if (!deployEnv.APP_VERSION) throw new Error("Variavel obrigatoria ausente: APP_VERSION");
fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(deployEnv, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});

const missingCredentials = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"].filter(
  (name) => !deployEnv[name]
);
console.log(`Arquivo de deploy criado com ${Object.keys(deployEnv).length} variaveis.`);
console.log(`Fonte local: ${fs.existsSync(envFile) ? envFile : "nenhum .env encontrado"}.`);
if (missingCredentials.length > 0) {
  console.warn(`Aviso: credenciais Langfuse ausentes: ${missingCredentials.join(", ")}.`);
} else {
  console.log("Configuracao Langfuse incluida (valores omitidos). ");
}
