# Chelaile HTTP API Guide

`chelaile-api-server` exposes Chelaile realtime transit capabilities, previously available only through MCP (stdio), as a read-only HTTP JSON API.
No login, account, or upstream API key is required. Start the server and use it immediately.

- Default address: `http://127.0.0.1:8787`
- All application endpoints use the `/v1` prefix and `GET` (`HEAD` and `OPTIONS` are also supported).
- All responses are UTF-8 JSON.

> Chinese place names, line names, and status values in examples are preserved as returned by the upstream; translating the documentation does not change API data.
- Endpoint index: `GET /` or `GET /v1`

---

## Contents

- [1. Quick start](#1-quick-start)
- [2. General conventions](#2-general-conventions)
- [3. Endpoint reference](#3-endpoint-reference)
  - [Basic information](#31-basic-information)
  - [Geolocation](#32-geolocation)
  - [Search](#33-search)
  - [Stops](#34-stops)
  - [Lines](#35-lines)
  - [Transit planning](#36-transit-planning)
- [4. Hosting static data on GitHub](#4-hosting-static-data-on-github)
- [5. Deployment](#5-deployment)
- [6. Environment variables](#6-environment-variables)
- [7. FAQ](#7-faq)
- [8. MCP compatibility](#8-mcp-compatibility)

---

## 1. Quick start

### Hosted instances

- Cloudflare Workers (recommended; no cold starts): <https://ts-api.tundrey.com>
- Vercel: <https://chelaile-api-server.vercel.app>

```bash
curl "https://ts-api.tundrey.com/v1/health"
curl "https://ts-api.tundrey.com/v1/search?city_id=034&keyword=71"
```

### Run from source

```bash
git clone https://github.com/Justintunsday/chelaile-api-server.git
cd chelaile-api-server
npm install
npm run build
npm start
# chelaile-api v2.0.0 listening on http://0.0.0.0:8787 (data: ./data)
```

### Your first request

```bash
curl "http://127.0.0.1:8787/v1/cities"
```

```json
{
  "origin": "file",
  "updatedAt": "2026-01-01T03:17:00.000Z",
  "hotOnly": true,
  "count": 12,
  "total": 480,
  "cities": [
    { "cityId": "034", "cityName": "上海", "pinyin": "ShangHai", "supportSubway": true, "hot": true }
  ]
}
```

### Check when bus 71 will arrive

```bash
# 1. Find the city ID, line ID, stop ID, and stop order.
curl "http://127.0.0.1:8787/v1/search?city_id=034&keyword=71"

# 2. Query realtime arrivals.
curl "http://127.0.0.1:8787/v1/lines/realtime?city_id=034&line_id=21283603183&target_order=2&station_id=021-15232&lat=31.2304&lng=121.4737"
```

---

## 2. General conventions

### 2.1 Authentication

Authentication is disabled by default. When `API_KEY` is set, all `/v1/*` requests must include one of these credentials:

| Method | Example |
| --- | --- |
| `X-API-Key` header | `curl -H "X-API-Key: <key>" ...` |
| Bearer Token | `curl -H "Authorization: Bearer <key>" ...` |
| Query parameter | `curl "...?key=<key>"` |

Missing or invalid credentials return `401 unauthorized`. `GET /` (the endpoint index) is public.

### 2.2 CORS

- `CORS_ORIGIN=*` allows browser requests from any origin by default.
- To use an allowlist, separate origins with commas: `CORS_ORIGIN=https://a.com,https://b.com`.
- Disallowed origins return `403 origin_not_allowed` for application requests. Preflight requests (`OPTIONS`) return `204`; disallowed origins receive no CORS allow headers.

### 2.3 Rate limiting

Disabled by default. Set `RATE_LIMIT_PER_MINUTE` to apply a fixed one-minute window per client IP. Excess requests return
`429 rate_limited` with `Retry-After: 60`. Behind a reverse proxy, forward `X-Forwarded-For`.

### 2.4 Error format

```json
{
  "error": {
    "code": "invalid_params",
    "message": "One or more request parameters are invalid.",
    "details": [{ "param": "lat", "message": "must be a decimal number, e.g. '31.230416'" }]
  }
}
```

| HTTP | code | Description |
| --- | --- | --- |
| 400 | `invalid_params` | Missing, malformed, or out-of-range parameters |
| 401 | `unauthorized` | API key authentication is enabled, but the key is missing or invalid |
| 403 | `origin_not_allowed` | Origin is not in the CORS allowlist |
| 404 | `not_found` | Unknown path |
| 405 | `method_not_allowed` | Method other than GET/HEAD/OPTIONS |
| 429 | `rate_limited` | Rate limit exceeded |
| 502 | `upstream_error` | Unexpected or unparseable upstream response |
| 504 | `upstream_timeout` | Upstream timeout (15 seconds by default) |

### 2.5 Coordinate systems (important)

The upstream endpoints require different coordinate systems. Using the wrong one can **shift results by hundreds of meters**:

| Coordinate system | Usage |
| --- | --- |
| **WGS-84** | Inputs to `/v1/stops/nearby`, `/v1/lines/realtime`, `/v1/lines/detail` (optional lat/lng), and `/v1/reverse-geocode`; `stations[].lat/lng` and `wgsLat/wgsLng` are WGS-84 |
| **GCJ-02** | Inputs to `/v1/transit/plan`; `pois[].lat/lng` returned by `/v1/search` are GCJ-02 |

Convert coordinates before calling an endpoint if you have WGS-84 but need GCJ-02, or vice versa.

### 2.6 Common fields

| Field | Meaning |
| --- | --- |
| `capacity` | Crowding: `0` uncrowded, `1` moderate, `2` crowded |
| `arrivalTime` | Unix timestamp in milliseconds; `-1` means unknown |
| `travelTime` | Seconds remaining until the target stop; `-1` means unknown |
| `eta` | `{ travelTime, arrivalTime, displayTime? }`; populated only for the nearest bus heading to the target stop; `null` for other buses |
| `isSubway` | Whether this is a metro line |
| `distance` | Meters; omitted in some responses |
| Time fields | Beijing time (the upstream local timezone, UTC+8) |

### 2.7 Caching

| Endpoint | `Cache-Control` |
| --- | --- |
| `/v1/cities` | `public, max-age=3600` (`no-store` when `live=true`) |
| `/v1/cities/config` | `public, max-age=600` |
| `/v1/reverse-geocode` | `public, max-age=86400` |
| `/v1/lines/route`, `/v1/lines/timetable` | `public, max-age=86400 / 3600` |
| Realtime endpoints | `no-store` |

CDNs and browsers follow these cache headers. Realtime endpoints are not cached.

---

## 3. Endpoint reference

### 3.1 Basic information

#### GET /v1/health

Liveness probe. No parameters.

```json
{
  "status": "ok",
  "name": "chelaile-api",
  "version": "2.0.0",
  "time": "2026-01-01T00:00:00.000Z",
  "uptimeSeconds": 42
}
```

#### GET /v1/cities

Lists supported cities. By default, reads `data/cities.json` (which can be hosted on GitHub) instead of calling the upstream on every request.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `hot_only` | boolean | `true` | Return popular cities only (about 12); `false` returns all approximately 480 cities |
| `live` | boolean | `false` | When `true`, bypass local/remote datasets and query the upstream directly |

Boolean parameters accept `true/false` and `1/0`.

Response fields:

| Field | Description |
| --- | --- |
| `origin` | Data source: `file` (local file), `github` (`DATA_BASE_URL`), or `upstream` (live upstream) |
| `updatedAt` | Dataset snapshot timestamp |
| `count` / `total` | Count after filtering / total dataset size |
| `cities[]` | `{ cityId, cityName, pinyin?, supportSubway, hot }` |

#### GET /v1/cities/config

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID, e.g. `034` (Shanghai) or `027` (Beijing) |

```json
{
  "maxInterval": 30,
  "arrivingStationLimitSeconds": 180,
  "busDisplayConfig": { "lineDetail": "time#order#distance", "other": "time#order" }
}
```

### 3.2 Geolocation

#### GET /v1/reverse-geocode

WGS-84 latitude/longitude → address in Chinese.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `lat` | number string | Yes | WGS-84 latitude, e.g. `31.230416` |
| `lng` | number string | Yes | WGS-84 longitude, e.g. `121.473701` |

```json
{
  "formatted": "上海市黄浦区南京东路街道延安高架路凯迪拉克·上海音乐厅",
  "province": "上海市",
  "city": "上海市",
  "district": "黄浦区",
  "township": "南京东路街道",
  "citycode": "021",
  "adcode": "310101"
}
```

> For directly administered municipalities, the upstream returns an empty `city`; this server fills it with `province`.

#### GET /v1/my-location

Estimates location by IP at city-level precision (about 10 km), insufficient for finding individual bus stops.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `ip` | string | No | IP to look up; when omitted, uses the **server egress IP**, so servers in mainland China give the most useful results |

```json
{
  "lat": 31.2222,
  "lng": 121.4581,
  "gpsType": "wgs",
  "city": "上海",
  "region": "上海市",
  "country": "中国",
  "ip": "116.236.0.1",
  "isp": "China Telecom",
  "precision": "city-level (~10 km); not suitable for stop-level queries",
  "inChina": true
}
```

IPs outside China (common with VPNs/proxies) include a `warning` and `inChina: false`.

### 3.3 Search

#### GET /v1/search

Search lines, stops, and points of interest (POIs) together by keyword within a city.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID |
| `keyword` | string | Yes | Search term, e.g. `71`, `71路` (bus 71), `地铁2号线` (metro line 2), `陆家嘴` (Lujiazui), or `人民广场` (People's Square) |

```json
{
  "highlightKey": "71路",
  "lines": [
    {
      "name": "71",
      "lineNo": "r95817",
      "isSubway": false,
      "directions": [
        { "direction": 0, "lineId": "21283603183", "startSn": "延安东路外滩", "endSn": "申昆路枢纽站" },
        { "direction": 1, "lineId": "21283603182", "startSn": "申昆路枢纽站", "endSn": "延安东路外滩" }
      ],
      "lineId": "21283603183",
      "direction": 0,
      "startSn": "延安东路外滩",
      "endSn": "申昆路枢纽站"
    }
  ],
  "stations": [
    {
      "sId": "021-15232",
      "sn": "西藏中路",
      "lat": 31.231006,
      "lng": 121.474316,
      "gpsType": "wgs",
      "physicalStId": "2868ecd4156f42b4b4cd38bfbd5dcb00",
      "namesakeStId": "c2bd23ef55aa0701976b156087099c9c",
      "isSubway": false
    }
  ],
  "pois": [
    {
      "name": "71路",
      "address": "中山东一路",
      "tag": "公交线路",
      "district": "黄浦区",
      "lat": 31.233021,
      "lng": 121.49073,
      "gpsType": "gcj"
    }
  ]
}
```

Key points:

- Both directions of a line are grouped in `directions[]`. Top-level `lineId/direction/startSn/endSn` are compatibility fields for direction 0.
- Lines with `isSubway: true` are not supported by `/v1/lines/detail` (returns `empty: true`); use `/v1/stops/detail` or `/v1/transit/plan`.
- `stations[].lat/lng` use WGS-84; `pois[].lat/lng` use GCJ-02.

#### GET /v1/search/more

Paginated “show more” results. Accepts the same parameters as `/v1/search`, plus:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `"1" \| "2" \| "3"` | `"1"` | `1` more lines, `2` more stops, `3` more POIs |

### 3.4 Stops

#### GET /v1/stops/nearby

Nearby stops and realtime arrivals for each line.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `city_id` | string | Yes | | City ID |
| `lat` | number string | Yes | | WGS-84 latitude |
| `lng` | number string | Yes | | WGS-84 longitude |
| `limit` | integer | No | `5` | Number of nearest stops to return, from 1 to 20 |

```json
{
  "stops": [
    {
      "sId": "021-15232",
      "sn": "西藏中路",
      "distance": 87,
      "isSubway": false,
      "physicalStId": "2868ecd4156f42b4b4cd38bfbd5dcb00",
      "namesakeStId": "c2bd23ef55aa0701976b156087099c9c",
      "lines": [
        {
          "lineId": "21283603183",
          "name": "71",
          "direction": 0,
          "endSn": "申昆路枢纽站",
          "status": "",
          "targetOrder": 2,
          "targetStationId": "021-15232",
          "buses": [
            { "busId": "021-15232-1", "order": 2, "arrivalTime": 1779070466055, "travelTime": 90, "distanceToDest": 881, "capacity": 0 }
          ]
        }
      ],
      "subwayLines": []
    }
  ]
}
```

- Use `lines[].targetOrder`, `lines[].targetStationId`, and `lineId` directly to construct a `/v1/lines/realtime` request.
- If there are no live buses but a departure is imminent, `preArrivalTime` is the estimated departure time (`HH:MM`).

#### GET /v1/stops/detail

All lines serving a physical stop, live buses, and nearby metro services.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID |
| `physical_st_id` | string | Yes | From `/v1/stops/nearby` or `/v1/search` |
| `namesake_st_id` | string | No | From the same source; recommended |
| `first_line_id` | string | No | Highlight a particular line |
| `lat` / `lng` | number string | No | Include to receive `distance` |

```json
{
  "stations": [
    {
      "sId": "021-15232",
      "sn": "西藏中路",
      "lat": 31.231006,
      "lng": 121.474316,
      "lines": [
        {
          "lineId": "21283603183",
          "name": "71",
          "direction": 0,
          "startSn": "延安东路外滩",
          "endSn": "申昆路枢纽站",
          "firstTime": "05:30",
          "lastTime": "23:30",
          "price": "2元",
          "targetOrder": 2,
          "buses": []
        }
      ],
      "metros": [{ "name": "地铁2号线", "lineNo": "2号线", "color": "140,194,32" }]
    }
  ]
}
```

Multiple `stations[]` entries indicate that the stop name corresponds to several physical platforms.

### 3.5 Lines

#### GET /v1/lines/detail

Complete line information: first/last departures, fares, all stops, current buses, and the reverse-direction lineId.

> **Metro lines are not supported**: returns `empty: true` and `hint`. Use `/v1/stops/detail` or `/v1/transit/plan` for metro services.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID |
| `line_id` | string | Yes | Line ID (from `/v1/search`) |
| `lat` / `lng` | number string | No | WGS-84; optional |

```json
{
  "line": {
    "lineId": "21283603183",
    "name": "71",
    "lineNo": "r95817",
    "direction": 0,
    "startSn": "延安东路外滩",
    "endSn": "申昆路枢纽站",
    "firstTime": "05:30",
    "lastTime": "23:30",
    "price": "2元",
    "stationsNum": 24
  },
  "stations": [
    {
      "order": 1,
      "sId": "...",
      "sn": "延安东路外滩",
      "wgsLat": 31.23,
      "wgsLng": 121.49,
      "physicalStId": "...",
      "namesakeStId": "...",
      "metros": [{ "name": "地铁14号线", "lineNo": "14号线", "color": "97,96,32" }]
    }
  ],
  "buses": [{ "busId": "...", "order": 2, "lat": 31.23, "lng": 121.47, "speed": 5.7, "capacity": 0 }],
  "reverseDirection": {
    "lineId": "21283603182",
    "startSn": "申昆路枢纽站",
    "endSn": "延安东路外滩",
    "firstTime": "04:30",
    "lastTime": "22:30",
    "price": "2元"
  },
  "depDesc": "...",
  "preArrivalTime": "...",
  "targetOrder": 24
}
```

#### GET /v1/lines/route

Line geometry coordinates for drawing routes on a map.

| Parameter | Type | Required / default | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID |
| `line_id` | string | Yes | Line ID |
| `include_shape` | boolean | `false` | `false`: stop markers only (about 25 points); `true`: all shape points (about 400–500) |

```json
{
  "pointCount": 480,
  "stopCount": 23,
  "points": [{ "lat": 31.23, "lng": 121.49, "stopOrder": 1 }]
}
```

> The upstream occasionally omits the terminus marker. `stopCount` may be one less than `stationsNum` from `/v1/lines/detail`; route drawing is unaffected.

#### GET /v1/lines/realtime

Query realtime bus information for vehicles heading to a specific stop.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID |
| `line_id` | string | Yes | Line ID |
| `target_order` | integer string | Yes | Waiting stop order on the line (from `line_detail.stations[].order` or `stops/nearby.lines[].targetOrder`) |
| `station_id` | string | Yes | Waiting stop `sId` (from `stops/nearby.lines[].targetStationId` or `stations[].sId`) |
| `lat` / `lng` | number string | Yes | WGS-84; use stop coordinates if the user location is unknown |

```json
{
  "line": { "lineId": "21283603183", "name": "71", "direction": 0, "endSn": "申昆路枢纽站" },
  "targetOrder": 2,
  "realData": true,
  "buses": [
    {
      "busId": "...",
      "licence": "沪A12345",
      "order": 2,
      "lat": 31.23,
      "lng": 121.47,
      "speed": 5.7,
      "capacity": 0,
      "distanceToWaitStn": 90,
      "eta": { "travelTime": 25, "arrivalTime": 1779070466055, "displayTime": "10:14" }
    },
    { "busId": "...", "order": 3, "lat": 31.24, "lng": 121.46, "speed": 3, "capacity": 0, "eta": null }
  ],
  "note": "Upstream only predicts an ETA for the nearest bus heading to your stop. ..."
}
```

> The upstream calculates `eta` only for the **nearest bus** heading to the target stop. `null` for other buses is expected.

#### GET /v1/lines/buses

The one or two buses expected to reach the target stop first, for an “arriving soon” display.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID |
| `line_id` | string | Yes | Line ID |
| `target_order` | integer string | Yes | Waiting stop order |
| `station_name` | string | Yes | Waiting stop name (for display) |

```json
{
  "targetOrder": 2,
  "buses": [
    {
      "busId": "...",
      "licence": "沪A12345",
      "order": 2,
      "lat": 31.23,
      "lng": 121.47,
      "speed": 8.2,
      "capacity": 0,
      "nextStop": "西藏中路",
      "eta": { "travelTime": 214, "arrivalTime": 1779070686000, "displayTime": "10:18" }
    }
  ]
}
```

#### GET /v1/lines/timetable

Line departure timetable. Only a few lines provide individual departure times; most Shanghai lines run at fixed intervals.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID |
| `line_id` | string | Yes | Line ID |
| `line_no` | string | Yes | **Passenger-facing short name** (`search.lines[].name`, e.g. `71`), rather than the internal `lineNo` (e.g. `r95817`) |
| `direction` | `"0" \| "1"` | Yes | Direction |

```json
{
  "line": { "lineId": "21283603183", "name": "71", "direction": 0, "startSn": "...", "endSn": "..." },
  "timeTableType": 2,
  "mode": "interval",
  "timetable": null,
  "note": "This line runs at a fixed interval — the upstream does not return per-trip departure times. ..."
}
```

`mode` values: `scheduled` (individual departures), `interval` (fixed intervals), `special`, or `unknown`.

> For first/last departures or operating hours, prefer `/v1/lines/detail`; its `firstTime/lastTime` are more reliable.

#### GET /v1/lines/refresh

Refresh multiple (line, stop) pairs in one request, useful for a favorite-lines dashboard.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID |
| `line_stn` | string | Yes | Tuples `lineId,stopId,nextId,targetOrder`, separated by `;`; `nextId` may be empty. At most 10 tuples are recommended |

```bash
curl "http://127.0.0.1:8787/v1/lines/refresh?city_id=034&line_stn=21283603183,021-15232,,2;21283604388,021-8685,,4"
```

```json
{
  "lines": [
    {
      "line": { "lineId": "21283603183", "name": "71", "direction": 0, "endSn": "申昆路枢纽站" },
      "depDesc": "10分钟后发车",
      "buses": [
        { "busId": "...", "order": 2, "capacity": 0, "distanceToDest": 881, "eta": { "travelTime": 221, "arrivalTime": 1779070466055 } }
      ]
    }
  ]
}
```

### 3.6 Transit planning

#### GET /v1/transit/plan

Bus and metro journey planning with multiple alternatives.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `city_id` | string | Yes | City ID |
| `origin_name` | string | Yes | Origin name (for display) |
| `origin_lat` / `origin_lng` | number string | Yes | Origin coordinates, **GCJ-02** |
| `dest_name` | string | Yes | Destination name |
| `dest_lat` / `dest_lng` | number string | Yes | Destination coordinates, **GCJ-02** |
| `strategy` | `"0" \| "1" \| "2" \| "3"` | No | `0` recommended (default, includes metro), `1` fewer transfers, `2` less walking, `3` shortest time (**upstream often excludes metro alternatives**) |

```bash
curl "http://127.0.0.1:8787/v1/transit/plan?city_id=034&origin_name=人民广场&origin_lat=31.233021&origin_lng=121.49073&dest_name=虹桥火车站&dest_lat=31.197&dest_lng=121.327&strategy=0"
```

```json
{
  "origin": "121.49073,31.233021",
  "destination": "121.327,31.197",
  "distance": 17982,
  "plans": [
    {
      "duration": 3056,
      "walkingDistance": 1466,
      "distance": 19086,
      "tag": "直达",
      "transitCount": 1,
      "segments": [
        { "type": "walking", "distance": 837, "duration": 717 },
        {
          "type": "bus",
          "name": "地铁2号线",
          "lineType": 1,
          "departureStop": "人民广场",
          "arrivalStop": "虹桥2号航站楼",
          "viaStops": 8,
          "duration": 1800,
          "distance": 17620,
          "startTime": "05:37",
          "endTime": "23:30"
        }
      ]
    }
  ]
}
```

`lineType`: `0` bus, `1` metro. Durations are in seconds; distances are in meters.

---

## 4. Hosting static data on GitHub

Realtime endpoints must query the upstream, but **infrequently changing data such as the city list** can be hosted statically.
This repository stores `data/cities.json` on GitHub; the API reads it by default instead of calling the upstream on every request.

### 4.1 Data file

`data/cities.json` is generated by a script and can be committed. `updatedAt` changes only when the city list content changes:

```json
{
  "updatedAt": "2026-01-01T03:17:00.000Z",
  "source": "chelaile:/wwd/ncitylist",
  "count": 480,
  "cities": [
    { "cityId": "027", "cityName": "北京", "pinyin": "BeiJing", "supportSubway": true, "hot": true }
  ]
}
```

### 4.2 Manual synchronization

```bash
npm run sync-data               # Write data/cities.json using tsx.
bun scripts/sync-data.ts        # Or run directly with Bun.
bun scripts/sync-data.ts out.json --force   # Set output file / bypass the drop safeguard.
```

### 4.3 Automatic synchronization with GitHub Actions

The repository includes `.github/workflows/sync-data.yml` (workflow name: **Sync data**):

| Trigger | Description |
| --- | --- |
| Schedule | Daily at `03:17 UTC` (11:17 Beijing time) |
| Manual | Actions → Sync data → Run workflow; select `force` to bypass the drop safeguard |
| Push | Runs when `scripts/sync-data.ts`, the workflow, `package.json`, or `bun.lock` changes |

Built-in reliability measures:

- **Retries**: retry upstream fetches up to three times with exponential backoff.
- **Minimum count**: fail without overwriting the dataset if fewer than 50 cities are returned.
- **Drop safeguard**: reject updates if the city count falls by more than 40%; run manually with `force` to override.
- **Idempotent commits**: unchanged city lists do not rewrite the file or create timestamp-only commits.
- **Concurrency safety**: automatically rebase and retry up to three times if a concurrent push is rejected.
- **Run summary**: report city count, popular-city count, and whether a commit was created on the Actions page.

The workflow uses Bun, matching the repository `bun.lock`. Before the first run, open
**Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**;
otherwise `git push` will be rejected.

### 4.4 Read data from GitHub or a CDN

Set `DATA_BASE_URL` to the HTTP dataset directory, such as this repository's raw URL or jsDelivr:

```bash
# GitHub raw (for low traffic; not recommended for high concurrency)
DATA_BASE_URL="https://raw.githubusercontent.com/Justintunsday/chelaile-api-server/main/data"

# jsDelivr (recommended; CDN caching)
DATA_BASE_URL="https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data"
```

The API requests `${DATA_BASE_URL}/cities.json`.

### 4.5 Data loading priority

```
Memory cache (CITIES_CACHE_TTL_MS; six hours by default)
  └─ 1. DATA_BASE_URL (GitHub/CDN, if configured)
  └─ 2. Local file DATA_DIR/cities.json
  └─ 3. Upstream /wwd/ncitylist (fallback)
```

`GET /v1/cities?live=true` always bypasses these caches and queries the upstream, returning `origin: upstream`.

---

## 5. Deployment

### 5.1 Run directly with Node

```bash
npm ci
npm run build
PORT=8787 DATA_BASE_URL="https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data" npm start
```

For process management, use `systemd`, `pm2`, or Docker with `restart=always`.

### 5.2 Docker

```bash
docker build -t chelaile-api .
docker run -d --name chelaile-api -p 8787:8787 \
  -e DATA_BASE_URL="https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data" \
  -e API_KEY="your-secret" \
  chelaile-api
```

The image includes the compiled application and the `data/` dataset.

### 5.3 Hosted platforms (deploy from GitHub)

> **GitHub Pages and GitHub Actions cannot serve this API directly.** Pages hosts static files and cannot
> make upstream requests, sign with MD5, or decrypt with AES. Actions cannot expose a permanent public port.
> This repository uses Pages for documentation and Actions for scheduled dataset updates; deploy the API to a platform below.

| Platform | Deployment | Notes |
| --- | --- | --- |
| **Cloudflare Workers** | `npx wrangler deploy -c worker/wrangler.toml` | No server maintenance or cold starts; `worker/` reuses the core logic; a custom domain is needed for mainland China (`*.workers.dev` is unavailable there) |
| **Vercel** | Import this repository at vercel.com/new | `vercel.json` declares **Services + container**, builds the Dockerfile, and forwards all paths; no manual Framework Preset setting is needed; deployment has been verified |
| **Render** | Blueprint: <https://render.com/deploy?repo=https://github.com/Justintunsday/chelaile-api-server> | Uses `render.yaml` and Dockerfile; the documented free plan requires card verification and sleeps after 15 minutes of inactivity |
| **Railway** | New Project → Deploy from GitHub repo | Reads `railway.json` and Dockerfile automatically |
| **VPS** | `npm ci && npm run build && npm start` or Docker | Full control; manage with systemd/pm2 |
| **GitHub Codespaces (temporary)** | Code → Codespaces, run `npm ci && npm run build && npm start`, then make port 8787 Public | Temporary testing only; sleeps and has free-usage limits |

#### Cloudflare Workers deployment steps

```bash
npx wrangler login
npx wrangler deploy -c worker/wrangler.toml
```

1. After deployment, open Cloudflare Dashboard → **Workers & Pages → chelaile-api → Settings → Domains & Routes**,
   and bind a custom domain already managed by Cloudflare.
2. Local development/testing: `npm run dev:worker` (default http://127.0.0.1:8787).
3. Optional configuration:
   - `DATA_BASE_URL` and `CORS_ORIGIN`: edit `[vars]` in `worker/wrangler.toml` and redeploy;
   - `API_KEY`: `npx wrangler secret put API_KEY -c worker/wrangler.toml`.
4. Notes:
   - `wrangler.toml` enables `nodejs_compat` and `brotli_content_encoding`; without the Brotli flag, large responses may hang.
   - The original deployment notes specify a free-plan CPU limit of 10 ms per request; city caches and rate limits are per isolate and are not shared between instances.
   - Mainland traffic goes through overseas Cloudflare locations (such as Hong Kong or the western US), with documented latency of about 50–300 ms; use a custom domain for mainland access.

- **Hosting in or near mainland China** is recommended: `/v1/my-location` uses the server egress IP, and mainland connectivity to `web.chelaile.net.cn` is generally more stable.
- **Vercel environment variables**: set `DATA_BASE_URL=https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data` in Production to load the hosted city dataset.
- **Timeouts**: each upstream request has a 15-second timeout. For serverless deployments, allow at least 20 seconds; the Vercel container service uses Services rather than the legacy `functions.maxDuration` configuration.

### 5.4 Reverse proxy

Nginx example:

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Forward `X-Forwarded-For` so rate limiting and logs can use the real client IP.

---

## 6. Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Listening port |
| `HOST` | `0.0.0.0` | Bind address |
| `CORS_ORIGIN` | `*` | Allowed origins, comma-separated; `*` allows all |
| `API_KEY` | Unset | When set, `/v1/*` requires `X-API-Key`, Bearer authentication, or `?key=` |
| `RATE_LIMIT_PER_MINUTE` | `0` (disabled) | Maximum requests per IP per minute |
| `DATA_DIR` | `./data` | Local dataset directory |
| `DATA_BASE_URL` | Unset | GitHub/jsDelivr dataset directory URL, without a trailing slash |
| `CITIES_CACHE_TTL_MS` | `21600000` (6h) | In-memory city dataset cache duration; `0` disables caching |
| `LOG_REQUESTS` | `true` | Whether to print access logs |

---

## 7. FAQ

**Why do I get `502 upstream_error` or `504 upstream_timeout`?**
The upstream `web.chelaile.net.cn` can be unstable. `504` means the 15-second timeout was exceeded; retrying usually helps.
`502` means the upstream returned an unexpected structure. Include `error.message` when reporting the issue.

**Why does `/v1/lines/detail` return `empty: true`?**
The line is usually a metro line (unsupported by this endpoint) or no longer operating. Follow the response `hint` and use `/v1/stops/detail`
for metro information or `/v1/transit/plan` for journey planning.

**Why are most `eta` values in `/v1/lines/realtime` `null`?**
Only the nearest bus heading to the target stop gets an ETA prediction. Other buses still include position, speed, and crowding.

**How do `physicalStId`, `sId`, and `targetOrder` differ?**
`sId` identifies a line/stop instance for realtime queries; `physicalStId` identifies a physical platform for stop details;
`targetOrder` is the stop order along the line. Find IDs with `/v1/search`, then obtain the stop order from `/v1/stops/nearby` or `/v1/lines/detail`.

**Why does transit planning require GCJ-02 while other endpoints use WGS-84?**
This follows the upstream API. Search POI coordinates already use GCJ-02 and can be passed directly to `/v1/transit/plan`.

**Why is `/v1/my-location` inaccurate?**
IP geolocation is only city-level; VPNs and proxies locate the egress IP. When `ip` is omitted,
the result locates the server, with mainland-hosted servers giving the most useful results.

**Can I use this data commercially?**
This project adapts public upstream interfaces for learning and research. Follow the upstream terms of service and avoid high-frequency scraping and commercial use.

---

## 8. MCP compatibility

The original MCP capabilities remain available: the same code provides both the HTTP API and an MCP stdio service with 15 tools
(`bus_list_cities`, `bus_search`, `bus_get_nearby_stops`, `bus_get_line_realtime`, `bus_plan_transit` …).

Start the MCP service:

```bash
npm run start:mcp
# Or
node dist/index.js
```

Register the local build in Claude Code / Claude Desktop (replace the path with your checkout):

```json
{
  "mcpServers": {
    "chelaile": { "command": "node", "args": ["/path/to/chelaile-api-server/dist/index.js"] }
  }
}
```

MCP tools and their HTTP equivalents:

| MCP tool | HTTP endpoint |
| --- | --- |
| `bus_list_cities` | `GET /v1/cities` |
| `bus_get_city_config` | `GET /v1/cities/config` |
| `bus_get_my_location` | `GET /v1/my-location` |
| `bus_reverse_geocode` | `GET /v1/reverse-geocode` |
| `bus_search` | `GET /v1/search` |
| `bus_search_more` | `GET /v1/search/more` |
| `bus_get_nearby_stops` | `GET /v1/stops/nearby` |
| `bus_get_stop_detail` | `GET /v1/stops/detail` |
| `bus_get_line_detail` | `GET /v1/lines/detail` |
| `bus_get_line_route` | `GET /v1/lines/route` |
| `bus_get_line_realtime` | `GET /v1/lines/realtime` |
| `bus_list_line_buses` | `GET /v1/lines/buses` |
| `bus_get_timetable` | `GET /v1/lines/timetable` |
| `bus_refresh_lines` | `GET /v1/lines/refresh` |
| `bus_plan_transit` | `GET /v1/transit/plan` |
