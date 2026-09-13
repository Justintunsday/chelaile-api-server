import { fetchCityConfig } from "../tools/city.js";
import { fetchMyLocation, fetchReverseGeo } from "../tools/geo.js";
import { fetchSearch, fetchSearchMore } from "../tools/search.js";
import { fetchNearbyStops, fetchStopDetail } from "../tools/stops.js";
import {
  fetchLineBuses,
  fetchLineDetail,
  fetchLineRealtime,
  fetchLineRoute,
  fetchRefresh,
  fetchTimetable,
} from "../tools/lines.js";
import { fetchTransitPlan } from "../tools/transit.js";
import type { CityStore } from "./data.js";
import { sendJson } from "./http.js";
import type { RequestContext } from "./router.js";
import {
  citiesQuery,
  cityConfigQuery,
  lineBusesQuery,
  lineDetailQuery,
  lineRealtimeQuery,
  lineRouteQuery,
  myLocationQuery,
  nearbyQuery,
  parseParams,
  refreshQuery,
  reverseGeoQuery,
  searchMoreQuery,
  searchQuery,
  stopDetailQuery,
  timetableQuery,
  transitQuery,
} from "./schemas.js";
import { API_NAME, API_VERSION } from "./version.js";

export interface EndpointDoc {
  method: "GET";
  path: string;
  description: string;
}

export const ENDPOINT_INDEX: EndpointDoc[] = [
  { method: "GET", path: "/v1/health", description: "Service liveness probe" },
  { method: "GET", path: "/v1/cities", description: "Supported cities (static dataset or upstream)" },
  { method: "GET", path: "/v1/cities/config", description: "City refresh interval / display config" },
  { method: "GET", path: "/v1/reverse-geocode", description: "WGS-84 coordinates → Chinese address" },
  { method: "GET", path: "/v1/my-location", description: "Approximate caller location from an IP" },
  { method: "GET", path: "/v1/search", description: "Search lines, stops and POIs by keyword" },
  { method: "GET", path: "/v1/search/more", description: "Paginated 'see more' for one search category" },
  { method: "GET", path: "/v1/stops/nearby", description: "Nearby stops + realtime arrivals" },
  { method: "GET", path: "/v1/stops/detail", description: "All lines + buses + metro for a stop" },
  { method: "GET", path: "/v1/lines/detail", description: "Full line info: stops + live buses" },
  { method: "GET", path: "/v1/lines/route", description: "Line polyline coordinates for maps" },
  { method: "GET", path: "/v1/lines/realtime", description: "Realtime buses + ETA for (line, stop)" },
  { method: "GET", path: "/v1/lines/buses", description: "Nearest approaching bus for a stop" },
  { method: "GET", path: "/v1/lines/timetable", description: "Per-trip schedule (rarely available)" },
  { method: "GET", path: "/v1/lines/refresh", description: "Batch refresh multiple (line, stop) pairs" },
  { method: "GET", path: "/v1/transit/plan", description: "Bus + metro transit route planning" },
];

export interface HandlerDeps {
  cityStore: CityStore;
  startedAt?: number;
}

export type Handlers = ReturnType<typeof createHandlers>;

export function createHandlers(deps: HandlerDeps) {
  const { cityStore } = deps;
  const startedAt = deps.startedAt ?? Date.now();

  return {
    root(ctx: RequestContext): void {
      sendJson(ctx.res, 200, {
        name: API_NAME,
        version: API_VERSION,
        description:
          "Read-only HTTP API for 车来了 (Chelaile) realtime bus, metro and transit data.",
        docs: "docs/API.md",
        endpoints: ENDPOINT_INDEX,
      });
    },

    health(ctx: RequestContext): void {
      sendJson(
        ctx.res,
        200,
        {
          status: "ok",
          name: API_NAME,
          version: API_VERSION,
          time: new Date().toISOString(),
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        },
        { "Cache-Control": "no-store" },
      );
    },

    async listCities(ctx: RequestContext): Promise<void> {
      const q = parseParams(citiesQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await cityStore.servedCities(q.hot_only, q.live);
      sendJson(ctx.res, 200, data, {
        "Cache-Control": q.live ? "no-store" : "public, max-age=3600",
      });
    },

    async cityConfig(ctx: RequestContext): Promise<void> {
      const q = parseParams(cityConfigQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchCityConfig(q.city_id);
      sendJson(ctx.res, 200, data, {
        "Cache-Control": "public, max-age=600",
      });
    },

    async reverseGeo(ctx: RequestContext): Promise<void> {
      const q = parseParams(reverseGeoQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchReverseGeo(q.lat, q.lng);
      sendJson(ctx.res, 200, data, {
        "Cache-Control": "public, max-age=86400",
      });
    },

    async myLocation(ctx: RequestContext): Promise<void> {
      const q = parseParams(myLocationQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchMyLocation(q.ip);
      sendJson(ctx.res, 200, data, { "Cache-Control": "private, no-store" });
    },

    async search(ctx: RequestContext): Promise<void> {
      const q = parseParams(searchQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchSearch(q.city_id, q.keyword);
      sendJson(ctx.res, 200, data, { "Cache-Control": "no-store" });
    },

    async searchMore(ctx: RequestContext): Promise<void> {
      const q = parseParams(searchMoreQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchSearchMore(q.city_id, q.keyword, q.type);
      sendJson(ctx.res, 200, data, { "Cache-Control": "no-store" });
    },

    async nearbyStops(ctx: RequestContext): Promise<void> {
      const q = parseParams(nearbyQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchNearbyStops(q.city_id, q.lat, q.lng, q.limit);
      sendJson(ctx.res, 200, data, { "Cache-Control": "no-store" });
    },

    async stopDetail(ctx: RequestContext): Promise<void> {
      const q = parseParams(stopDetailQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchStopDetail({
        cityId: q.city_id,
        physicalStId: q.physical_st_id,
        namesakeStId: q.namesake_st_id,
        firstLineId: q.first_line_id,
        lat: q.lat,
        lng: q.lng,
      });
      sendJson(ctx.res, 200, data, { "Cache-Control": "no-store" });
    },

    async lineDetail(ctx: RequestContext): Promise<void> {
      const q = parseParams(lineDetailQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchLineDetail(q.city_id, q.line_id, q.lat, q.lng);
      sendJson(ctx.res, 200, data, { "Cache-Control": "no-store" });
    },

    async lineRoute(ctx: RequestContext): Promise<void> {
      const q = parseParams(lineRouteQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchLineRoute(q.city_id, q.line_id, q.include_shape);
      sendJson(ctx.res, 200, data, {
        "Cache-Control": "public, max-age=86400",
      });
    },

    async lineRealtime(ctx: RequestContext): Promise<void> {
      const q = parseParams(lineRealtimeQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchLineRealtime({
        cityId: q.city_id,
        lineId: q.line_id,
        targetOrder: q.target_order,
        stationId: q.station_id,
        lat: q.lat,
        lng: q.lng,
      });
      sendJson(ctx.res, 200, data, { "Cache-Control": "no-store" });
    },

    async lineBuses(ctx: RequestContext): Promise<void> {
      const q = parseParams(lineBusesQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchLineBuses({
        cityId: q.city_id,
        lineId: q.line_id,
        targetOrder: q.target_order,
        stationName: q.station_name,
      });
      sendJson(ctx.res, 200, data, { "Cache-Control": "no-store" });
    },

    async timetable(ctx: RequestContext): Promise<void> {
      const q = parseParams(timetableQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchTimetable({
        cityId: q.city_id,
        lineId: q.line_id,
        lineNo: q.line_no,
        direction: q.direction,
      });
      sendJson(ctx.res, 200, data, {
        "Cache-Control": "public, max-age=3600",
      });
    },

    async refresh(ctx: RequestContext): Promise<void> {
      const q = parseParams(refreshQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchRefresh(q.city_id, q.line_stn);
      sendJson(ctx.res, 200, data, { "Cache-Control": "no-store" });
    },

    async transitPlan(ctx: RequestContext): Promise<void> {
      const q = parseParams(transitQuery, Object.fromEntries(ctx.url.searchParams));
      const data = await fetchTransitPlan({
        cityId: q.city_id,
        originName: q.origin_name,
        originLat: q.origin_lat,
        originLng: q.origin_lng,
        destName: q.dest_name,
        destLat: q.dest_lat,
        destLng: q.dest_lng,
        strategy: q.strategy,
      });
      sendJson(ctx.res, 200, data, { "Cache-Control": "no-store" });
    },
  };
}
