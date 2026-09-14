// Cloudflare Workers entrypoint.
// Reuses the same domain logic as the Node API (src/tools/* fetch + reshape)
// with a fetch-based transport and bundled/remote city dataset.
import bundledCities from "../data/cities.json";
import { ENDPOINT_INDEX } from "../src/api/handlers.js";
import {
  ApiError,
  methodNotAllowed,
  notFound,
  toApiError,
  unauthorized,
} from "../src/api/errors.js";
import { parseParams } from "../src/api/schemas.js";
import {
  citiesQuery,
  cityConfigQuery,
  lineBusesQuery,
  lineDetailQuery,
  lineRealtimeQuery,
  lineRouteQuery,
  myLocationQuery,
  nearbyQuery,
  refreshQuery,
  reverseGeoQuery,
  searchMoreQuery,
  searchQuery,
  stopDetailQuery,
  timetableQuery,
  transitQuery,
} from "../src/api/schemas.js";
import { API_NAME, API_VERSION } from "../src/api/version.js";
import {
  fetchCityConfig,
  fetchCityList,
  type LeanCity,
} from "../src/tools/city.js";
import { fetchMyLocation, fetchReverseGeo } from "../src/tools/geo.js";
import { fetchSearch, fetchSearchMore } from "../src/tools/search.js";
import { fetchNearbyStops, fetchStopDetail } from "../src/tools/stops.js";
import {
  fetchLineBuses,
  fetchLineDetail,
  fetchLineRealtime,
  fetchLineRoute,
  fetchRefresh,
  fetchTimetable,
} from "../src/tools/lines.js";
import { fetchTransitPlan } from "../src/tools/transit.js";

export interface Env {
  DATA_BASE_URL?: string;
  API_KEY?: string;
  CORS_ORIGIN?: string;
}

interface CityDataset {
  updatedAt: string;
  source: string;
  cities: LeanCity[];
}

interface Ctx {
  url: URL;
  query: Record<string, string>;
  env: Env;
}

type Handler = (ctx: Ctx) => Promise<Response>;

const ISOLATE_START = Date.now();
const CITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Documentation site: reverse-proxied from GitHub Pages so it stays current
// (the Pages workflow keeps rebuilding it) while being served from the
// Cloudflare edge — GitHub Pages itself is often slow or unreachable in
// mainland China.
const DOCS_HOSTNAME = "chelaile-api-docs.tundrey.com";
const API_HOSTNAME = "ts-api.tundrey.com";
const DOCS_UPSTREAM = "https://justintunsday.github.io";
const DOCS_PATH_PREFIX = "/chelaile-api-server";
const DOCS_CACHE_SECONDS = 600;

const NO_STORE = { "Cache-Control": "no-store" };
const CACHE_HOUR = { "Cache-Control": "public, max-age=3600" };
const CACHE_TEN_MIN = { "Cache-Control": "public, max-age=600" };
const CACHE_DAY = { "Cache-Control": "public, max-age=86400" };

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function errorResponse(
  error: ApiError,
  cors: Record<string, string> = {},
): Response {
  const headers: Record<string, string> = { ...cors };
  if (error.status === 429) headers["Retry-After"] = "60";
  return json(error.status, error.toBody(), headers);
}

interface CorsResult {
  allowed: boolean;
  headers: Record<string, string>;
}

function corsFor(configured: string, origin: string | null): CorsResult {
  const base = {
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (configured === "*") {
    return {
      allowed: true,
      headers: { ...base, "Access-Control-Allow-Origin": "*" },
    };
  }
  const allowList = configured
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin) return { allowed: true, headers: {} };
  if (allowList.includes(origin)) {
    return {
      allowed: true,
      headers: {
        ...base,
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
      },
    };
  }
  return { allowed: false, headers: {} };
}

function isAuthorized(request: Request, url: URL, apiKey: string): boolean {
  if (request.headers.get("x-api-key") === apiKey) return true;
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7) === apiKey) return true;
  return url.searchParams.get("key") === apiKey;
}

// ---------- docs proxy ----------

async function handleDocs(request: Request, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return errorResponse(methodNotAllowed(method, url.pathname));
  }
  if (url.pathname === "/v1" || url.pathname.startsWith("/v1/")) {
    return Response.redirect(
      `https://${API_HOSTNAME}${url.pathname}${url.search}`,
      302,
    );
  }

  // GitHub Pages serves the site under /chelaile-api-server; internal links
  // already use that prefix, while root-relative requests need it added.
  const upstreamPath = url.pathname.startsWith(DOCS_PATH_PREFIX)
    ? url.pathname
    : `${DOCS_PATH_PREFIX}${url.pathname === "/" ? "/" : url.pathname}`;
  const upstreamUrl = `${DOCS_UPSTREAM}${upstreamPath}${url.search}`;

  const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
  const cacheKey = new Request(upstreamUrl, { method: "GET" });
  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return new Response(cached.body, cached);
    } catch {
      // cache unavailable; fall through to the network
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: { "user-agent": "chelaile-docs-proxy" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return json(
      502,
      {
        error: {
          code: "docs_upstream_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      NO_STORE,
    );
  }

  const headers = new Headers(upstream.headers);
  if (upstream.ok) {
    headers.set("Cache-Control", `public, max-age=${DOCS_CACHE_SECONDS}`);
  }
  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
  if (upstream.ok && cache) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch {
      // ignore cache write failures
    }
  }
  return response;
}

// ---------- city dataset (remote → bundled → upstream) ----------

let cityCache: { dataset: CityDataset; origin: string; at: number } | null =
  null;

function parseDataset(raw: unknown): CityDataset | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.cities) || obj.cities.length === 0) return null;
  const cities: LeanCity[] = [];
  for (const item of obj.cities) {
    if (item == null || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const cityId = typeof c.cityId === "string" ? c.cityId : "";
    const cityName = typeof c.cityName === "string" ? c.cityName : "";
    if (!cityId || !cityName) continue;
    cities.push({
      cityId,
      cityName,
      ...(typeof c.pinyin === "string" && c.pinyin ? { pinyin: c.pinyin } : {}),
      supportSubway: c.supportSubway === true,
      hot: c.hot === true,
    });
  }
  if (cities.length === 0) return null;
  return {
    updatedAt:
      typeof obj.updatedAt === "string" && obj.updatedAt
        ? obj.updatedAt
        : new Date(0).toISOString(),
    source:
      typeof obj.source === "string" && obj.source ? obj.source : "unknown",
    cities,
  };
}

async function loadCities(
  env: Env,
  live: boolean,
): Promise<{ dataset: CityDataset; origin: string }> {
  if (!live) {
    const now = Date.now();
    if (cityCache && now - cityCache.at < CITY_CACHE_TTL_MS) {
      return { dataset: cityCache.dataset, origin: cityCache.origin };
    }
    if (env.DATA_BASE_URL) {
      try {
        const base = env.DATA_BASE_URL.replace(/\/+$/, "");
        const res = await fetch(`${base}/cities.json`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const dataset = parseDataset(await res.json());
          if (dataset) {
            cityCache = { dataset, origin: "github", at: now };
            return { dataset, origin: "github" };
          }
        }
      } catch {
        // fall through to the bundled dataset
      }
    }
    const bundled = parseDataset(bundledCities);
    if (bundled) {
      cityCache = { dataset: bundled, origin: "file", at: now };
      return { dataset: bundled, origin: "file" };
    }
  }
  const { cities } = await fetchCityList(false);
  const dataset: CityDataset = {
    updatedAt: new Date().toISOString(),
    source: "chelaile:/wwd/ncitylist",
    cities,
  };
  if (!live) cityCache = { dataset, origin: "upstream", at: Date.now() };
  return { dataset, origin: "upstream" };
}

// ---------- handlers ----------

async function index(): Promise<Response> {
  return json(200, {
    name: API_NAME,
    version: API_VERSION,
    runtime: "cloudflare-workers",
    description:
      "Read-only HTTP API for 车来了 (Chelaile) realtime bus, metro and transit data.",
    docs: "docs/API.md",
    endpoints: ENDPOINT_INDEX,
  });
}

async function health(): Promise<Response> {
  return json(
    200,
    {
      status: "ok",
      name: API_NAME,
      version: API_VERSION,
      runtime: "cloudflare-workers",
      time: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - ISOLATE_START) / 1000),
    },
    NO_STORE,
  );
}

async function listCities({ url, env }: Ctx): Promise<Response> {
  const q = parseParams(citiesQuery, Object.fromEntries(url.searchParams));
  const { dataset, origin } = await loadCities(env, q.live);
  const cities = q.hot_only
    ? dataset.cities.filter((c) => c.hot)
    : dataset.cities;
  return json(
    200,
    {
      origin,
      updatedAt: dataset.updatedAt,
      hotOnly: q.hot_only,
      count: cities.length,
      total: dataset.cities.length,
      cities,
    },
    q.live ? NO_STORE : CACHE_HOUR,
  );
}

async function cityConfig({ url }: Ctx): Promise<Response> {
  const q = parseParams(cityConfigQuery, Object.fromEntries(url.searchParams));
  return json(200, await fetchCityConfig(q.city_id), CACHE_TEN_MIN);
}

async function reverseGeo({ url }: Ctx): Promise<Response> {
  const q = parseParams(reverseGeoQuery, Object.fromEntries(url.searchParams));
  return json(200, await fetchReverseGeo(q.lat, q.lng), CACHE_DAY);
}

async function myLocation({ url }: Ctx): Promise<Response> {
  const q = parseParams(myLocationQuery, Object.fromEntries(url.searchParams));
  return json(200, await fetchMyLocation(q.ip), NO_STORE);
}

async function search({ url }: Ctx): Promise<Response> {
  const q = parseParams(searchQuery, Object.fromEntries(url.searchParams));
  return json(200, await fetchSearch(q.city_id, q.keyword), NO_STORE);
}

async function searchMore({ url }: Ctx): Promise<Response> {
  const q = parseParams(searchMoreQuery, Object.fromEntries(url.searchParams));
  return json(
    200,
    await fetchSearchMore(q.city_id, q.keyword, q.type),
    NO_STORE,
  );
}

async function nearbyStops({ url }: Ctx): Promise<Response> {
  const q = parseParams(nearbyQuery, Object.fromEntries(url.searchParams));
  return json(
    200,
    await fetchNearbyStops(q.city_id, q.lat, q.lng, q.limit),
    NO_STORE,
  );
}

async function stopDetail({ url }: Ctx): Promise<Response> {
  const q = parseParams(stopDetailQuery, Object.fromEntries(url.searchParams));
  return json(
    200,
    await fetchStopDetail({
      cityId: q.city_id,
      physicalStId: q.physical_st_id,
      namesakeStId: q.namesake_st_id,
      firstLineId: q.first_line_id,
      lat: q.lat,
      lng: q.lng,
    }),
    NO_STORE,
  );
}

async function lineDetail({ url }: Ctx): Promise<Response> {
  const q = parseParams(lineDetailQuery, Object.fromEntries(url.searchParams));
  return json(
    200,
    await fetchLineDetail(q.city_id, q.line_id, q.lat, q.lng),
    NO_STORE,
  );
}

async function lineRoute({ url }: Ctx): Promise<Response> {
  const q = parseParams(lineRouteQuery, Object.fromEntries(url.searchParams));
  return json(
    200,
    await fetchLineRoute(q.city_id, q.line_id, q.include_shape),
    CACHE_DAY,
  );
}

async function lineRealtime({ url }: Ctx): Promise<Response> {
  const q = parseParams(lineRealtimeQuery, Object.fromEntries(url.searchParams));
  return json(
    200,
    await fetchLineRealtime({
      cityId: q.city_id,
      lineId: q.line_id,
      targetOrder: q.target_order,
      stationId: q.station_id,
      lat: q.lat,
      lng: q.lng,
    }),
    NO_STORE,
  );
}

async function lineBuses({ url }: Ctx): Promise<Response> {
  const q = parseParams(lineBusesQuery, Object.fromEntries(url.searchParams));
  return json(
    200,
    await fetchLineBuses({
      cityId: q.city_id,
      lineId: q.line_id,
      targetOrder: q.target_order,
      stationName: q.station_name,
    }),
    NO_STORE,
  );
}

async function timetable({ url }: Ctx): Promise<Response> {
  const q = parseParams(timetableQuery, Object.fromEntries(url.searchParams));
  return json(
    200,
    await fetchTimetable({
      cityId: q.city_id,
      lineId: q.line_id,
      lineNo: q.line_no,
      direction: q.direction,
    }),
    CACHE_HOUR,
  );
}

async function refresh({ url }: Ctx): Promise<Response> {
  const q = parseParams(refreshQuery, Object.fromEntries(url.searchParams));
  return json(200, await fetchRefresh(q.city_id, q.line_stn), NO_STORE);
}

async function transitPlan({ url }: Ctx): Promise<Response> {
  const q = parseParams(transitQuery, Object.fromEntries(url.searchParams));
  return json(
    200,
    await fetchTransitPlan({
      cityId: q.city_id,
      originName: q.origin_name,
      originLat: q.origin_lat,
      originLng: q.origin_lng,
      destName: q.dest_name,
      destLat: q.dest_lat,
      destLng: q.dest_lng,
      strategy: q.strategy,
    }),
    NO_STORE,
  );
}

const routes: Record<string, Handler> = {
  "/": index,
  "/v1": index,
  "/v1/health": health,
  "/v1/cities": listCities,
  "/v1/cities/config": cityConfig,
  "/v1/reverse-geocode": reverseGeo,
  "/v1/my-location": myLocation,
  "/v1/search": search,
  "/v1/search/more": searchMore,
  "/v1/stops/nearby": nearbyStops,
  "/v1/stops/detail": stopDetail,
  "/v1/lines/detail": lineDetail,
  "/v1/lines/route": lineRoute,
  "/v1/lines/realtime": lineRealtime,
  "/v1/lines/buses": lineBuses,
  "/v1/lines/timetable": timetable,
  "/v1/lines/refresh": refresh,
  "/v1/transit/plan": transitPlan,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === DOCS_HOSTNAME) {
      return handleDocs(request, url);
    }

    const method = request.method.toUpperCase();
    const configured = env.CORS_ORIGIN?.trim() || "*";
    const cors = corsFor(configured, request.headers.get("origin"));

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors.headers });
    }
    if (!cors.allowed) {
      return errorResponse(
        new ApiError(
          403,
          "origin_not_allowed",
          `Origin ${request.headers.get("origin") ?? "(none)"} is not allowed by CORS_ORIGIN.`,
        ),
      );
    }
    if (
      env.API_KEY &&
      url.pathname.startsWith("/v1") &&
      !isAuthorized(request, url, env.API_KEY)
    ) {
      return errorResponse(unauthorized(), cors.headers);
    }

    const pathname =
      url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
    const handler = routes[pathname];
    if (!handler) {
      return errorResponse(notFound(url.pathname), cors.headers);
    }
    if (method !== "GET" && method !== "HEAD") {
      return errorResponse(methodNotAllowed(method, url.pathname), cors.headers);
    }

    try {
      const response = await handler({
        url,
        env,
        query: Object.fromEntries(url.searchParams),
      });
      for (const [name, value] of Object.entries(cors.headers)) {
        response.headers.set(name, value);
      }
      if (method === "HEAD") {
        return new Response(null, {
          status: response.status,
          headers: response.headers,
        });
      }
      return response;
    } catch (error) {
      return errorResponse(toApiError(error), cors.headers);
    }
  },
};
