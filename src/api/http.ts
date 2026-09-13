import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "./errors.js";

export interface ResponseHeaders {
  [name: string]: string;
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: ResponseHeaders = {},
): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export function sendError(
  res: ServerResponse,
  error: ApiError,
  headers: ResponseHeaders = {},
): void {
  const extra = { ...headers };
  if (error.status === 429) {
    extra["Retry-After"] = "60";
  }
  sendJson(res, error.status, error.toBody(), extra);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function queryObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    out[key] = value;
  }
  return out;
}

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(",")[0]?.trim() || "unknown";
  }
  return req.socket?.remoteAddress ?? "unknown";
}

export function corsHeaders(origin: string, reqOrigin?: string): ResponseHeaders {
  const allowOrigin = origin === "*" ? "*" : reqOrigin ?? origin;
  const headers: ResponseHeaders = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (origin !== "*") {
    headers.Vary = "Origin";
  }
  return headers;
}

export function isOriginAllowed(configured: string, reqOrigin?: string): boolean {
  if (configured === "*") return true;
  if (!reqOrigin) return true;
  const allowed = configured
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(reqOrigin);
}
