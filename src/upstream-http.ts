import * as zlib from "node:zlib";

// Bound both wire bytes and decoded bytes. No query values or response bodies
// are included in transport errors, since they can contain credentials.
export const MAX_UPSTREAM_BODY_BYTES = 16 * 1024 * 1024;

class UpstreamResponseError extends Error {}

export function decompress(buffer: Buffer, encoding: string | undefined): Buffer {
  const options = { maxOutputLength: MAX_UPSTREAM_BODY_BYTES };
  if (encoding === "br") return zlib.brotliDecompressSync(buffer, options);
  if (encoding === "gzip") return zlib.gunzipSync(buffer, options);
  if (encoding === "deflate") return zlib.inflateSync(buffer, options);
  return buffer;
}

export function isCloudflareWorker(): boolean {
  try {
    return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
  } catch { return false; }
}

export async function readResponseText(res: Response): Promise<string> {
  if (!res.ok) {
    await res.body?.cancel();
    throw new UpstreamResponseError(`Upstream HTTP ${res.status}`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPSTREAM_BODY_BYTES) {
        await reader.cancel();
        throw new UpstreamResponseError("Upstream response too large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

interface RequestOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  fetchTimeoutMs?: number;
  fetchAttempts?: number;
}

async function fetchGet(url: URL, options: RequestOptions): Promise<string> {
  const headers = { ...options.headers };
  delete headers.Host;
  delete headers.Connection;
  const attempts = options.fetchAttempts ?? 1;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(options.fetchTimeoutMs ?? options.timeoutMs),
      });
      return await readResponseText(res);
    } catch (error) {
      if (error instanceof UpstreamResponseError || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function nodeGet(url: URL, options: RequestOptions): Promise<string> {
  const [https, http] = await Promise.all([import("node:https"), import("node:http")]);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let deadline: ReturnType<typeof setTimeout>;
    const fail = (error: Error) => { clearTimeout(deadline); reject(error); };
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "GET",
      headers: options.headers,
      timeout: options.timeoutMs,
    }, (res) => {
      res.on("error", fail);
      res.on("aborted", () => fail(new Error("Upstream response interrupted")));
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        fail(new UpstreamResponseError(`Upstream HTTP ${res.statusCode ?? 0}`));
        res.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_UPSTREAM_BODY_BYTES) {
          const error = new UpstreamResponseError("Upstream response too large");
          fail(error);
          res.destroy(error);
        } else chunks.push(chunk);
      });
      res.on("end", () => {
        clearTimeout(deadline);
        try {
          if (!res.complete) throw new Error("Upstream response interrupted");
          const body = decompress(Buffer.concat(chunks), res.headers["content-encoding"]);
          resolve(body.toString("utf8"));
        } catch (error) { reject(error); }
      });
      res.on("close", () => {
        if (!res.complete) fail(new Error("Upstream response interrupted"));
      });
    });
    const timeout = () => req.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`));
    // An absolute deadline also bounds slowly dripping responses.
    deadline = setTimeout(timeout, options.timeoutMs);
    req.on("timeout", timeout);
    req.on("error", fail);
    req.end();
  });
}

export function requestText(url: URL, options: RequestOptions): Promise<string> {
  return isCloudflareWorker() ? fetchGet(url, options) : nodeGet(url, options);
}
