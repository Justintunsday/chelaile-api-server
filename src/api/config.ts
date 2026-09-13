export interface ApiConfig {
  host: string;
  port: number;
  corsOrigin: string;
  apiKey: string | null;
  rateLimitPerMinute: number;
  dataDir: string;
  dataBaseUrl: string | null;
  citiesCacheTtlMs: number;
  logRequests: boolean;
}

export const DEFAULTS = {
  HOST: "0.0.0.0",
  PORT: 8787,
  CORS_ORIGIN: "*",
  RATE_LIMIT_PER_MINUTE: 0,
  DATA_DIR: "./data",
  CITIES_CACHE_TTL_MS: 6 * 60 * 60 * 1000,
} as const;

function parseNumber(
  raw: string | undefined,
  fallback: number,
  env: NodeJS.ProcessEnv,
  name: string,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ${name}: "${raw}" is not a number`);
  }
  return n;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = parseNumber(env.PORT, DEFAULTS.PORT, env, "PORT");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${port}`);
  }
  const rateLimit = parseNumber(
    env.RATE_LIMIT_PER_MINUTE,
    DEFAULTS.RATE_LIMIT_PER_MINUTE,
    env,
    "RATE_LIMIT_PER_MINUTE",
  );
  if (!Number.isInteger(rateLimit) || rateLimit < 0) {
    throw new Error(`Invalid RATE_LIMIT_PER_MINUTE: ${rateLimit}`);
  }
  const ttl = parseNumber(
    env.CITIES_CACHE_TTL_MS,
    DEFAULTS.CITIES_CACHE_TTL_MS,
    env,
    "CITIES_CACHE_TTL_MS",
  );
  const rawBase = env.DATA_BASE_URL?.trim();
  return {
    host: env.HOST?.trim() || DEFAULTS.HOST,
    port,
    corsOrigin: env.CORS_ORIGIN?.trim() || DEFAULTS.CORS_ORIGIN,
    apiKey: env.API_KEY?.trim() || null,
    rateLimitPerMinute: rateLimit,
    dataDir: env.DATA_DIR?.trim() || DEFAULTS.DATA_DIR,
    dataBaseUrl: rawBase ? rawBase.replace(/\/+$/, "") : null,
    citiesCacheTtlMs: ttl,
    logRequests: parseBool(env.LOG_REQUESTS, true),
  };
}
