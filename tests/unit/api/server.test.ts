import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { loadConfig } from "../../../src/api/config.js";
import { CityStore } from "../../../src/api/data.js";
import { createApp } from "../../../src/api/server.js";

function makeStore(): CityStore {
  return new CityStore({
    dataDir: "definitely-missing-dir",
    dataBaseUrl: null,
    ttlMs: 60_000,
    fetchUpstream: async () => ({
      cities: [
        { cityId: "034", cityName: "上海", supportSubway: true, hot: true },
        { cityId: "100", cityName: "小城", supportSubway: false, hot: false },
      ],
    }),
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

describe("HTTP API server", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createApp({
      config: { ...loadConfig({}), port: 0, logRequests: false },
      cityStore: makeStore(),
    });
    base = await listen(server);
  });

  afterAll(async () => {
    await close(server);
  });

  test("GET / returns the endpoint index", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("chelaile-api");
    expect(Array.isArray(body.endpoints)).toBe(true);
  });

  test("GET /v1/health reports ok", async () => {
    const res = await fetch(`${base}/v1/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.version).toBeString();
  });

  test("GET /v1/cities serves hot cities by default", async () => {
    const res = await fetch(`${base}/v1/cities`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.origin).toBe("upstream");
    expect(body.count).toBe(1);
    expect(body.total).toBe(2);
    const cities = body.cities as Record<string, unknown>[];
    expect(cities[0].cityName).toBe("上海");
  });

  test("GET /v1/cities?hot_only=false returns the full list", async () => {
    const res = await fetch(`${base}/v1/cities?hot_only=false`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.count).toBe(2);
  });

  test("GET /v1/search without params returns 400 invalid_params", async () => {
    const res = await fetch(`${base}/v1/search?city_id=034`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe("invalid_params");
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  test("unknown routes return 404 not_found", async () => {
    const res = await fetch(`${base}/v1/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  test("non-GET methods return 405", async () => {
    const res = await fetch(`${base}/v1/health`, { method: "POST" });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("method_not_allowed");
  });

  test("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await fetch(`${base}/v1/search`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("HEAD mirrors GET headers", async () => {
    const res = await fetch(`${base}/v1/health`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBeString();
  });
});

describe("API key authentication", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createApp({
      config: {
        ...loadConfig({}),
        port: 0,
        logRequests: false,
        apiKey: "sekret",
      },
      cityStore: makeStore(),
    });
    base = await listen(server);
  });

  afterAll(async () => {
    await close(server);
  });

  test("rejects requests without a key", async () => {
    const res = await fetch(`${base}/v1/cities`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  test("accepts the X-API-Key header", async () => {
    const res = await fetch(`${base}/v1/cities`, {
      headers: { "x-api-key": "sekret" },
    });
    expect(res.status).toBe(200);
  });

  test("accepts a Bearer token", async () => {
    const res = await fetch(`${base}/v1/cities`, {
      headers: { authorization: "Bearer sekret" },
    });
    expect(res.status).toBe(200);
  });

  test("accepts the key query parameter", async () => {
    const res = await fetch(`${base}/v1/cities?key=sekret`);
    expect(res.status).toBe(200);
  });

  test("rejects a wrong key", async () => {
    const res = await fetch(`${base}/v1/cities`, {
      headers: { "x-api-key": "wrong" },
    });
    expect(res.status).toBe(401);
  });
});

describe("CORS allow-list", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createApp({
      config: {
        ...loadConfig({}),
        port: 0,
        logRequests: false,
        corsOrigin: "https://ok.example",
      },
      cityStore: makeStore(),
    });
    base = await listen(server);
  });

  afterAll(async () => {
    await close(server);
  });

  test("rejects disallowed origins", async () => {
    const res = await fetch(`${base}/v1/health`, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  test("echoes allowed origins", async () => {
    const res = await fetch(`${base}/v1/health`, {
      headers: { origin: "https://ok.example" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://ok.example",
    );
  });
});

describe("rate limiting", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createApp({
      config: {
        ...loadConfig({}),
        port: 0,
        logRequests: false,
        rateLimitPerMinute: 2,
      },
      cityStore: makeStore(),
    });
    base = await listen(server);
  });

  afterAll(async () => {
    await close(server);
  });

  test("the third request within a minute returns 429", async () => {
    expect((await fetch(`${base}/v1/health`)).status).toBe(200);
    expect((await fetch(`${base}/v1/health`)).status).toBe(200);
    const res = await fetch(`${base}/v1/health`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});
