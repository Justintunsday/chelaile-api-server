import { createHash, createDecipheriv } from "node:crypto";
import * as zlib from "node:zlib";
import {
  AES_KEY,
  BASE_DOMAIN,
  BASE_URL,
  DEFAULT_PARAMS,
  REQUEST_HEADERS,
  REQUEST_TIMEOUT_MS,
  SIGN_SALT,
} from "./constants.js";

export { BASE_DOMAIN, BASE_URL, DEFAULT_PARAMS };

export function cryptoSign(params: Record<string, string>): string {
  const str =
    Object.entries(params)
      .map(([k, v]) => `"${k}"="${v}"`)
      .join("&") + SIGN_SALT;
  return createHash("md5").update(str).digest("hex");
}

export function decryptResult(ciphertext: string): string {
  const key = Buffer.from(AES_KEY, "utf8");
  // ECB has no IV. Node accepts `null`; Workers' node:crypto requires a
  // non-null value, so pass an empty buffer (valid for ECB in both runtimes).
  const decipher = createDecipheriv("aes-256-ecb", key, Buffer.alloc(0));
  let decrypted = decipher.update(ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function parseEncryptedEnvelope(raw: string): unknown {
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) throw new Error("Upstream response is not JSON");

  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") depth--;
    if (depth === 0) {
      jsonEnd = i + 1;
      break;
    }
  }

  const envelope = JSON.parse(raw.substring(jsonStart, jsonEnd)) as {
    jsonr?: { data?: { encryptResult?: string } & Record<string, unknown> };
  };
  const data = envelope.jsonr?.data;
  if (!data) throw new Error("Upstream response missing jsonr.data");

  if (data.encryptResult) {
    return JSON.parse(decryptResult(data.encryptResult));
  }
  return data;
}

export function decompress(buffer: Buffer, encoding: string | undefined): Buffer {
  if (encoding === "br") return zlib.brotliDecompressSync(buffer);
  if (encoding === "gzip") return zlib.gunzipSync(buffer);
  if (encoding === "deflate") return zlib.inflateSync(buffer);
  return buffer;
}

export function isCloudflareWorker(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      navigator.userAgent === "Cloudflare-Workers"
    );
  } catch {
    return false;
  }
}

// fetch()-based transport used on Cloudflare Workers. The runtime negotiates
// and transparently decompresses content-encoding, so no zlib step is needed;
// hop-by-hop headers that the runtime owns must be omitted. Waiting on the
// origin does not consume Worker CPU, so allow a longer timeout than Node and
// retry once on transient network failures.
const WORKER_REQUEST_TIMEOUT_MS = 20_000;
const WORKER_FETCH_ATTEMPTS = 2;

async function fetchGet(url: URL): Promise<{ body: string }> {
  const headers: Record<string, string> = { ...REQUEST_HEADERS };
  delete headers.Host;
  delete headers.Connection;

  let lastError: unknown;
  for (let attempt = 1; attempt <= WORKER_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
      });
      return { body: await res.text() };
    } catch (error) {
      lastError = error;
      if (attempt < WORKER_FETCH_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  throw lastError;
}

async function nodeGet(url: URL): Promise<{ body: string }> {
  const [https, http] = await Promise.all([
    import("node:https"),
    import("node:http"),
  ]);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + (url.search || ""),
        method: "GET",
        headers: REQUEST_HEADERS,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const decompressed = decompress(
              Buffer.concat(chunks),
              res.headers["content-encoding"] as string | undefined,
            );
            resolve({ body: decompressed.toString("utf-8") });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

function rawGet(url: URL): Promise<{ body: string }> {
  return isCloudflareWorker() ? fetchGet(url) : nodeGet(url);
}

export async function request<T = unknown>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const signed = { ...params, cryptoSign: cryptoSign(params) };
  const u = new URL(url);
  u.search = new URLSearchParams(signed).toString();
  const { body } = await rawGet(u);
  return parseEncryptedEnvelope(body) as T;
}

export async function requestPlain<T = unknown>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const u = new URL(url);
  u.search = new URLSearchParams(params).toString();
  const { body } = await rawGet(u);
  const json = JSON.parse(body) as { data?: T };
  if (!json.data) throw new Error("Upstream plain response missing data");
  return json.data;
}

// For endpoints that return plain JSON with no encryption envelope (e.g. the
// geocoder, which proxies an upstream map service). Signs the params and
// parses the entire response body as JSON.
export async function requestRaw<T = unknown>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const signed = { ...params, cryptoSign: cryptoSign(params) };
  const u = new URL(url);
  u.search = new URLSearchParams(signed).toString();
  const { body } = await rawGet(u);
  return JSON.parse(body) as T;
}
