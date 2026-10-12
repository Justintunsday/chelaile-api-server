import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Server } from "node:http";
import { createApp } from "../../src/api/server.js";
import { loadConfig } from "../../src/api/config.js";
import worker from "../../worker/index.js";

// Deliberately literal: a route/parameter/default/response change must be reviewed.
const cases = [
  ["/v1/cities", "live=true"],
  ["/v1/cities/config", "city_id=034"],
  ["/v1/reverse-geocode", "lat=31.230416&lng=121.473701"],
  ["/v1/my-location", "ip=1.2.3.4"],
  ["/v1/search", "city_id=034&keyword=公交"],
  ["/v1/search/more", "city_id=034&keyword=公交"],
  ["/v1/stops/nearby", "city_id=034&lat=31.230416&lng=121.473701"],
  ["/v1/stops/detail", "city_id=034&physical_st_id=001"],
  ["/v1/lines/detail", "city_id=034&line_id=001"],
  ["/v1/lines/route", "city_id=034&line_id=001"],
  ["/v1/lines/realtime", "city_id=034&line_id=001&target_order=02&station_id=003&lat=31.230416&lng=121.473701"],
  ["/v1/lines/buses", "city_id=034&line_id=001&target_order=02&station_name=人民广场"],
  ["/v1/lines/timetable", "city_id=034&line_id=001&line_no=01&direction=0"],
  ["/v1/lines/refresh", "city_id=034&line_stn=001,002,03,004"],
  ["/v1/transit/plan", "city_id=034&origin_name=起点&origin_lat=31.232&origin_lng=121.479&dest_name=终点&dest_lat=31.24&dest_lng=121.49"],
] as const;

let server: Server;
let base: string;
let sent: { url: string; headers: unknown }[] = [];
const realFetch = globalThis.fetch;
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

beforeAll(async () => {
  // Stub only the external network; exercise real handlers, signing and reshaping.
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Cloudflare-Workers" } });
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "127.0.0.1") return realFetch(input, init);
    sent.push({ url: url.href, headers: init?.headers });
    if (url.hostname === "ip-api.com") return Response.json({ status: "success", country: "中国", regionName: "上海", city: "上海", lat: 31.23, lon: 121.47, query: "1.2.3.4", isp: "fixture" });
    if (url.pathname === "/wwd/ncitylist") return Response.json({ data: { cityList: [{ cityId: "034", cityName: "上海", isHot: 1, supportSubway: 1 }] } });
    if (url.pathname.includes("getLocationByGps")) return Response.json({ regeocode: { formatted_address: "上海", addressComponent: { province: "上海", city: [] } } });
    if (url.pathname.includes("preStartTimetableNew") && url.searchParams.get("lineNo") === "71") {
      return Response.json({ jsonr: { data: { line: { lineId: "001", name: "71", direction: 0, startSn: "起点", endSn: "终点" }, timeTableType: 1, timetable: [{ departureTime: "08:00" }, { departureTime: "08:30" }] } } });
    }
    return Response.json({ jsonr: { data: {} } });
  }) as typeof fetch;
  server = createApp({ config: { ...loadConfig({}), port: 0, logRequests: false } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  base = `http://127.0.0.1:${address.port}`;
});

test("available mainland scheduled departures pass through without inventing predictions", async () => {
  const path = "/v1/lines/timetable?city_id=034&line_id=001&line_no=71&direction=0";
  for (const runtime of ["node", "worker"]) {
    const response = runtime === "node" ? await fetch(`${base}${path}`)
      : await worker.fetch(new Request(`https://api.example${path}`), {});
    expect(await response.json()).toEqual({
      line: { lineId: "001", name: "71", direction: 0, startSn: "起点", endSn: "终点" },
      timeTableType: 1, mode: "scheduled",
      timetable: [{ departureTime: "08:00" }, { departureTime: "08:30" }],
    });
  }
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const [path, query] of cases) {
  test(`${path} preserves GET payload, defaults, ordered upstream params and fingerprint`, async () => {
    const results = [];
    for (const runtime of ["node", "worker"]) {
      sent = [];
      const response = runtime === "node"
        ? await fetch(`${base}${path}?${query}`)
        : await worker.fetch(new Request(`https://api.example${path}?${query}`), {});
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      if (path === "/v1/cities") {
        expect(body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        body.updatedAt = "<iso-time>";
      }
      const requests = sent.map(({ url, headers }) => {
        const parsed = new URL(url);
        // Timestamp and dependent signature vary; preserve key ordering and all other values.
        if (parsed.searchParams.has("departure_time")) {
          expect(parsed.searchParams.get("departure_time")).toMatch(/^\d{13}$/);
          parsed.searchParams.set("departure_time", "<timestamp>");
          parsed.searchParams.set("cryptoSign", "<timestamp-signature>");
        }
        return { url: parsed.href, headers };
      });
      results.push({ runtime, body, cache: response.headers.get("cache-control"), requests });
    }
    expect(results).toMatchSnapshot();
  });
}

test("index, aliases, HEAD, validation and error codes remain available in both runtimes", async () => {
  for (const runtime of ["node", "worker"]) {
    const call = (path: string, method = "GET") => runtime === "node"
      ? fetch(`${base}${path}`, { method })
      : worker.fetch(new Request(`https://api.example${path}`, { method }), {});
    for (const path of ["/", "/v1", "/v1/"]) {
      const response = await call(path);
      expect(await response.json()).toMatchSnapshot(`${runtime} ${path}`);
    }
    expect(await (await call("/v1/health", "HEAD")).text()).toBe("");
    expect((await call("/v1/health", "OPTIONS")).status).toBe(204);
    for (const [path, method] of [["/v1/nope", "GET"], ["/v1/search", "GET"], ["/v1/health", "POST"]]) {
      const response = await call(path, method);
      expect({ status: response.status, body: await response.json() }).toMatchSnapshot(`${runtime} ${path} ${method}`);
    }
  }
});
