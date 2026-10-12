import { afterAll, beforeAll, expect, test } from "bun:test";
import http, { type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { requestRaw } from "../../src/http-client.js";
import { toApiError } from "../../src/api/errors.js";
import { fetchMyLocation } from "../../src/tools/geo.js";
import { requestText } from "../../src/upstream-http.js";

let server: Server;
let base: string;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith("/error")) {
      res.writeHead(503);
      res.end('{"ok":true,"secret":"upstream-body"}');
    } else if (req.url?.startsWith("/redirect")) {
      res.writeHead(302, { Location: "/ok" });
      res.end('{"ok":true}');
    } else if (req.url?.startsWith("/truncated")) {
      res.writeHead(200, { "Content-Length": "100" });
      res.flushHeaders();
      res.write('{"ok":');
      setTimeout(() => res.destroy(), 10);
    } else if (req.url?.startsWith("/slow")) {
      res.writeHead(200);
      const timer = setInterval(() => res.write(" "), 5);
      res.on("close", () => clearInterval(timer));
    } else if (req.url?.startsWith("/oversized")) {
      res.writeHead(200);
      res.end(Buffer.alloc(17 * 1024 * 1024));
    } else if (req.url?.startsWith("/bomb")) {
      res.writeHead(200, { "Content-Encoding": "gzip" });
      res.end(gzipSync(Buffer.alloc(17 * 1024 * 1024)));
    } else {
      res.writeHead(200, { "Content-Encoding": "gzip" });
      res.end(gzipSync('{"ok":true}'));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("Node rejects non-2xx bodies instead of accepting plausible JSON", async () => {
  await expect(requestRaw(`${base}/error`, {})).rejects.toThrow(/HTTP 503/);
  await expect(requestRaw(`${base}/redirect`, {})).rejects.toThrow(/HTTP 302/);
});

test("Node still decompresses successful payloads", async () => {
  expect(await requestRaw(`${base}/ok`, {})).toEqual({ ok: true });
});

test("Node rejects truncated responses promptly instead of leaving promises pending", async () => {
  const outcome = await Promise.race([
    requestRaw(`${base}/truncated`, {}).then(() => "resolved", () => "rejected"),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 200)),
  ]);
  expect(outcome).toBe("rejected");
});

async function inWorker(fetchImpl: typeof fetch, action: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Cloudflare-Workers" } });
  globalThis.fetch = fetchImpl;
  try { await action(); }
  finally {
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}

test("Worker rejects HTTP errors without exposing bodies or retrying status responses", async () => {
  let calls = 0;
  await inWorker((async () => { calls++; return new Response('{"secret":"upstream-body"}', { status: 503 }); }) as typeof fetch, async () => {
    await expect(requestRaw("https://upstream.example", {})).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(1);
  });
});

test("Worker bounds decoded upstream bodies and cancels oversized streams", async () => {
  let cancelled = false;
  await inWorker((async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(17 * 1024 * 1024));
      setTimeout(() => { try { controller.close(); } catch {} }, 50);
    },
    cancel() { cancelled = true; },
  }))) as typeof fetch, async () => {
    await expect(requestRaw("https://upstream.example", {})).rejects.toThrow(/too large/i);
    expect(cancelled).toBe(true);
  });
});

test("Worker keeps its one retry for transient network failures", async () => {
  let calls = 0;
  await inWorker((async () => {
    if (++calls === 1) throw new TypeError("network failure");
    return Response.json({ ok: true });
  }) as typeof fetch, async () => {
    expect(await requestRaw("https://upstream.example", {})).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});

test("upstream HTTP failure uses the existing API error code", async () => {
  try { await requestRaw(`${base}/error`, {}); }
  catch (error) {
    expect(toApiError(error).code).toBe("upstream_error");
    expect(toApiError(error).message).not.toContain("upstream-body");
    return;
  }
  throw new Error("expected HTTP failure");
});

test("IP geolocation also rejects non-2xx JSON using its existing transport settings", async () => {
  await inWorker((async () => Response.json({ status: "success", lat: 1, lon: 2 }, { status: 500 })) as typeof fetch, async () => {
    await expect(fetchMyLocation("1.2.3.4")).rejects.toThrow(/HTTP 500/);
  });
});

test("Node limits both compressed and uncompressed sizes", async () => {
  await expect(requestRaw(`${base}/oversized`, {})).rejects.toThrow(/too large/i);
  await expect(requestRaw(`${base}/bomb`, {})).rejects.toThrow();
});

test("Node absolute timeout bounds a continuously dripping response", async () => {
  await expect(requestText(new URL(`${base}/slow`), { headers: {}, timeoutMs: 50 })).rejects.toThrow(/timed out/);
});
