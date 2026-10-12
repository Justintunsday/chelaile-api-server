import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("compiled HTTP entrypoint serves health and bundled data on Node/Bun", { timeout: 20_000 }, async () => {
  const child = spawn(process.execPath, ["dist/api/server.js"], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", API_KEY: "", CORS_ORIGIN: "*", DATA_BASE_URL: "", DATA_DIR: "./data", RATE_LIMIT_PER_MINUTE: "0", TRUSTED_PROXY_IPS: "", LOG_REQUESTS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = once(child, "exit");
  try {
    const base = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) resolve(match[1]);
      });
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`server exited: ${code}`)));
    });
    const health = await fetch(`${base}/v1/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
    const cities = await (await fetch(`${base}/v1/cities?hot_only=false`)).json();
    assert.equal(cities.origin, "file");
    assert.ok(cities.cities.some((city) => city.cityId === "034"));
  } finally {
    child.kill();
    await exit;
  }
});

test("compiled stdio MCP entrypoint exposes all existing tools", { timeout: 20_000 }, async () => {
  const client = new Client({ name: "runtime-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], stderr: "pipe" });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.equal(result.tools.length, 15);
    assert.ok(result.tools.some((tool) => tool.name === "bus_search"));
  } finally { await client.close(); }
});
