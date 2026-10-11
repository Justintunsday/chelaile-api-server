# Chelaile API (chelaile-api-server)

A **read-only HTTP JSON API** for [Chelaile](https://web.chelaile.net.cn) realtime transit data:
line schedules, live vehicle positions, nearby stops, keyword search, route geometry, and bus/metro journey planning.
No login or account is required. The original MCP service remains available for Claude Code and Cursor.

- **Hosted services (previously verified):** Cloudflare Workers <https://ts-api.tundrey.com> | Vercel <https://chelaile-api-server.vercel.app>
- **User guide (Wiki):** <https://github.com/Justintunsday/chelaile-api-server/wiki>
- **Full documentation: [docs/API.md](docs/API.md)** | Documentation site: <https://chelaile-api-docs.tundrey.com/>
- Default address: `http://127.0.0.1:8787`
- Endpoint index: `GET /`

## Features

- **Zero configuration**: no upstream account or API key needed.
- **REST interface**: GET endpoints with simplified JSON, grouped line directions, normalized coordinates, and irrelevant fields removed.
- **Two interfaces**: HTTP API and MCP stdio service share the same core logic.
- **Static data on GitHub**: GitHub Actions periodically syncs city lists and other infrequently changing data for loading from the repository/CDN, reducing upstream requests.
- **Operational controls**: optional API key, CORS allowlist, per-IP rate limiting, request logs, and health checks.

## Quick start

```bash
git clone https://github.com/Justintunsday/chelaile-api-server.git
cd chelaile-api-server
npm install
npm run build
npm start
```

```bash
curl "http://127.0.0.1:8787/v1/health"
curl "http://127.0.0.1:8787/v1/search?city_id=034&keyword=71"
```

## API endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/health` | Liveness probe |
| `GET /v1/cities` | Supported cities (popular by default; `hot_only=false` for all) |
| `GET /v1/cities/config` | City refresh intervals and display settings |
| `GET /v1/reverse-geocode` | WGS-84 coordinates → address in Chinese |
| `GET /v1/my-location` | City-level IP geolocation |
| `GET /v1/search` | Keyword search across lines, stops, and POIs |
| `GET /v1/search/more` | Paginated additional results for a category |
| `GET /v1/stops/nearby` | Nearby stops and realtime arrivals |
| `GET /v1/stops/detail` | All lines at a stop, live buses, and nearby metro services |
| `GET /v1/lines/detail` | Complete stop list and current buses (metro lines unsupported) |
| `GET /v1/lines/route` | Route geometry for maps |
| `GET /v1/lines/realtime` | Realtime ETA at a target stop |
| `GET /v1/lines/buses` | Nearest arriving buses |
| `GET /v1/lines/timetable` | Individual departure times, where available |
| `GET /v1/lines/refresh` | Batch refresh of (line, stop) pairs |
| `GET /v1/transit/plan` | Bus and metro journey planning |

See **[docs/API.md](docs/API.md)** for parameters, response examples, coordinate systems, and error codes.

### Request examples

```bash
# Realtime arrivals for bus 71 (line_id / target_order / station_id come from /v1/search or /v1/stops/nearby).
curl "http://127.0.0.1:8787/v1/lines/realtime?city_id=034&line_id=21283603183&target_order=2&station_id=021-15232&lat=31.2304&lng=121.4737"
```

```bash
# People's Square → Hongqiao Railway Station (GCJ-02 coordinates, available from search POIs).
curl "http://127.0.0.1:8787/v1/transit/plan?city_id=034&origin_name=人民广场&origin_lat=31.233021&origin_lng=121.49073&dest_name=虹桥火车站&dest_lat=31.197&dest_lng=121.327&strategy=0"
```

## Data hosted on GitHub

A script fetches `data/cities.json` from the upstream and commits it to the repository. `.github/workflows/sync-data.yml`
updates it daily at `03:17 UTC`, with three retries, a city-count drop safeguard, and no commits for unchanged data.
It also runs when the sync script changes, or manually from Actions. Data loading priority:

```
Memory cache → DATA_BASE_URL (GitHub raw / jsDelivr) → local data/cities.json → upstream
```

```bash
npm run sync-data   # Manually sync the city list.
```

Point deployments at your repository (jsDelivr is recommended for CDN caching):

```bash
DATA_BASE_URL="https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data" npm start
```

> Before the first workflow run, open **Settings → Actions → General → Workflow permissions** and enable
> **Read and write permissions**.

## Deployment

> **GitHub Pages and Actions cannot serve this API directly.** Pages serves static files and cannot make
> upstream requests, sign with MD5, or decrypt with AES. Actions cannot expose a permanent public port.
> `pages.yml` hosts only the **documentation**: https://justintunsday.github.io/chelaile-api-server/

Use the repository as a deployment source so a hosting platform builds and runs the application:

| Platform | Method | Notes |
| --- | --- | --- |
| **Cloudflare Workers** | `npx wrangler deploy -c worker/wrangler.toml` (bind a custom domain) | No server maintenance or cold starts; mainland traffic uses overseas locations; use a custom domain for mainland access |
| **Vercel** | Import at vercel.com/new (`vercel.json` declares Services + container builds) | Previously verified deployment: https://chelaile-api-server.vercel.app |
| **Render** | Deploy using `render.yaml` | The documented free plan requires card verification and sleeps after 15 minutes of inactivity |
| **Railway** | New Project → select this repository (reads `railway.json`) | Trial credits; no cold starts described in the original deployment notes |
| **VPS / Docker** | `docker build -t chelaile-api . && docker run -d -p 8787:8787 chelaile-api` | Full control; recommended for production |
| **Codespaces (temporary)** | Code → Codespaces, run `npm ci && npm run build && npm start`, then make port 8787 Public | Temporary public URL for testing |

Cloudflare Workers reuses the core logic in `worker/`. Run locally with `npm run dev:worker`:

```bash
npx wrangler login
npx wrangler deploy -c worker/wrangler.toml
# After deployment: Dashboard → Workers & Pages → chelaile-api → Settings → Domains & Routes
# Bind a custom domain for mainland access; *.workers.dev is blocked there.
```

Optional key: `npx wrangler secret put API_KEY -c worker/wrangler.toml`.
Configure `DATA_BASE_URL` and `CORS_ORIGIN` under `[vars]` in `worker/wrangler.toml`.

For Vercel, `vercel.json` uses **Services** (`runtime: "container"` plus an all-path rewrite).
Import the repository to build the Dockerfile; no manual Framework Preset setting is needed. For Production, set
`DATA_BASE_URL=https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data`.

Render deployment: <https://render.com/deploy?repo=https://github.com/Justintunsday/chelaile-api-server>

For Docker:

```bash
docker build -t chelaile-api .
docker run -d --name chelaile-api -p 8787:8787 chelaile-api
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Listening port |
| `HOST` | `0.0.0.0` | Bind address |
| `CORS_ORIGIN` | `*` | Allowed origins, comma-separated |
| `API_KEY` | Unset | When set, `/v1/*` requires `X-API-Key`, Bearer authentication, or `?key=` |
| `RATE_LIMIT_PER_MINUTE` | `0` | Requests per IP per minute; 0 disables limiting |
| `DATA_DIR` | `./data` | Local dataset directory |
| `DATA_BASE_URL` | Unset | GitHub/jsDelivr dataset URL |
| `CITIES_CACHE_TTL_MS` | `21600000` | In-memory city dataset cache duration |
| `LOG_REQUESTS` | `true` | Access logging switch |

## MCP service (optional)

All original MCP capabilities remain available. Start with:

```bash
npm run start:mcp   # node dist/index.js
```

Use in Claude Code / Claude Desktop (15 tools with the `bus_*` prefix). HTTP equivalents are listed in
[docs/API.md](docs/API.md#8-mcp-compatibility).

## Development

```bash
npm run dev          # API hot reload with tsx
npm run build        # Build with tsc
npm test             # Unit tests (bun test tests/unit)
npm run test:e2e     # End-to-end tests (network required; CHELAILE_E2E=1)
npm run sync-data    # Sync city data
```

## License

MIT

> Data comes from Chelaile public interfaces. This project adapts the protocol for learning and research.
> Follow the upstream terms of service and avoid high-frequency scraping and commercial use.
