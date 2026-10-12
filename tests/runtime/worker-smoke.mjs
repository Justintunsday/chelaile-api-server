import assert from "node:assert/strict";
import { test } from "node:test";
import { unstable_dev } from "wrangler";

test("workerd serves API contracts with the deployed compatibility settings", { timeout: 60_000 }, async () => {
  const worker = await unstable_dev("worker/index.ts", {
    config: "worker/wrangler.toml",
    local: true,
    ip: "127.0.0.1",
    port: 0,
    inspectorPort: 0,
    vars: { API_KEY: "smoke-key", DATA_BASE_URL: "" },
    logLevel: "error",
    experimental: { disableExperimentalWarning: true, watch: false },
  });
  try {
    const headers = { "x-api-key": "smoke-key" };
    assert.equal((await worker.fetch("/v1/health")).status, 401);
    const health = await worker.fetch("/v1/health", { headers });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).runtime, "cloudflare-workers");
    const cities = await (await worker.fetch("/v1/cities?hot_only=false", { headers })).json();
    assert.equal(cities.origin, "file");
    assert.ok(cities.cities.some((city) => city.cityId === "034"));
    const head = await worker.fetch("/v1/health", { method: "HEAD", headers });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const invalid = await worker.fetch("/v1/search", { headers });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "invalid_params");
  } finally { await worker.stop(); }
});
