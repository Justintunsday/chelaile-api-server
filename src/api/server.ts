#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig, type ApiConfig } from "./config.js";
import { CityStore } from "./data.js";
import {
  ApiError,
  methodNotAllowed,
  notFound,
  rateLimited,
  toApiError,
  unauthorized,
} from "./errors.js";
import { createHandlers, type Handlers } from "./handlers.js";
import {
  corsHeaders,
  getClientIp,
  isOriginAllowed,
  sendError,
} from "./http.js";
import { Router, type RequestContext } from "./router.js";
import { API_NAME, API_VERSION } from "./version.js";

export interface AppOptions {
  config: ApiConfig;
  cityStore?: CityStore;
  now?: () => number;
}

function registerRoutes(router: Router, handlers: Handlers): void {
  router.get("/", handlers.root);
  router.get("/v1", handlers.root);
  router.get("/v1/health", handlers.health);
  router.get("/v1/cities", handlers.listCities);
  router.get("/v1/cities/config", handlers.cityConfig);
  router.get("/v1/reverse-geocode", handlers.reverseGeo);
  router.get("/v1/my-location", handlers.myLocation);
  router.get("/v1/search", handlers.search);
  router.get("/v1/search/more", handlers.searchMore);
  router.get("/v1/stops/nearby", handlers.nearbyStops);
  router.get("/v1/stops/detail", handlers.stopDetail);
  router.get("/v1/lines/detail", handlers.lineDetail);
  router.get("/v1/lines/route", handlers.lineRoute);
  router.get("/v1/lines/realtime", handlers.lineRealtime);
  router.get("/v1/lines/buses", handlers.lineBuses);
  router.get("/v1/lines/timetable", handlers.timetable);
  router.get("/v1/lines/refresh", handlers.refresh);
  router.get("/v1/transit/plan", handlers.transitPlan);
}

class FixedWindowRateLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  allow(key: string, limitPerMinute: number, now = Date.now()): boolean {
    const window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + 60_000 });
      this.prune(now);
      return true;
    }
    if (window.count >= limitPerMinute) return false;
    window.count++;
    return true;
  }

  private prune(now: number): void {
    if (this.windows.size <= 10_000) return;
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(
  req: IncomingMessage,
  url: URL,
  apiKey: string,
): boolean {
  const header = req.headers["x-api-key"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (headerValue && safeEqual(headerValue, apiKey)) return true;

  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && safeEqual(auth.slice(7), apiKey)) {
    return true;
  }

  const queryKey = url.searchParams.get("key");
  if (queryKey && safeEqual(queryKey, apiKey)) return true;

  return false;
}

export function createApp(options: AppOptions): http.Server {
  const { config } = options;
  const now = options.now ?? (() => Date.now());
  const cityStore =
    options.cityStore ??
    new CityStore({
      dataDir: config.dataDir,
      dataBaseUrl: config.dataBaseUrl,
      ttlMs: config.citiesCacheTtlMs,
    });
  const handlers = createHandlers({ cityStore, startedAt: now() });
  const router = new Router();
  registerRoutes(router, handlers);
  const limiter = new FixedWindowRateLimiter();

  const listener = async (
    req: IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const started = now();
    let status = 200;
    const origin = req.headers.origin;
    const originAllowed = isOriginAllowed(config.corsOrigin, origin);
    if (originAllowed) {
      for (const [name, value] of Object.entries(corsHeaders(config.corsOrigin, origin))) {
        res.setHeader(name, value);
      }
    }

    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
      sendError(
        res,
        new ApiError(400, "invalid_url", "The request URL could not be parsed."),
      );
      return;
    }

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Content-Length": "0" });
        res.end();
        status = 204;
        return;
      }

      if (!originAllowed && config.corsOrigin !== "*") {
        throw new ApiError(
          403,
          "origin_not_allowed",
          `Origin ${origin ?? "(none)"} is not allowed by CORS_ORIGIN.`,
        );
      }

      if (
        config.apiKey &&
        url.pathname.startsWith("/v1") &&
        !isAuthorized(req, url, config.apiKey)
      ) {
        throw unauthorized();
      }

      if (config.rateLimitPerMinute > 0) {
        const ip = getClientIp(req);
        if (!limiter.allow(ip, config.rateLimitPerMinute, started)) {
          throw rateLimited(60);
        }
      }

      const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
      const match = router.match(method, url.pathname);
      if (match.type === "not_found") throw notFound(url.pathname);
      if (match.type === "method_not_allowed") {
        throw methodNotAllowed(req.method ?? "GET", url.pathname);
      }

      const ctx: RequestContext = {
        req,
        res,
        url,
        method,
        pathname: url.pathname,
        params: match.params,
        ip: getClientIp(req),
      };
      await match.handler(ctx);
      status = res.statusCode;
    } catch (error) {
      const apiError = toApiError(error);
      status = apiError.status;
      if (!res.headersSent) {
        sendError(res, apiError);
      } else {
        res.end();
      }
    } finally {
      if (config.logRequests) {
        const query = url.search ? url.search : "";
        console.log(
          `${req.method} ${url.pathname}${query} -> ${status} (${now() - started}ms)`,
        );
      }
    }
  };

  const server = http.createServer((req, res) => {
    void listener(req, res);
  });

  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  });

  return server;
}

export async function start(): Promise<http.Server> {
  const config = loadConfig();
  const server = createApp({ config });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port =
    address && typeof address === "object" ? address.port : config.port;
  const dataSource = config.dataBaseUrl ?? config.dataDir;
  console.log(
    `${API_NAME} v${API_VERSION} listening on http://${config.host}:${port} ` +
      `(data: ${dataSource})`,
  );
  if (config.apiKey) console.log("API key authentication is enabled.");
  if (config.rateLimitPerMinute > 0) {
    console.log(`Rate limit: ${config.rateLimitPerMinute} req/min per IP.`);
  }
  return server;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  start().catch((error) => {
    console.error("Fatal:", error);
    process.exit(1);
  });
}
