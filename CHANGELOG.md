# Changelog

## 2.0.0 (2026-09-14)

### Features

* HTTP JSON API under `/v1` covering every bus/metro capability (search, stops, lines, realtime ETA, routes, timetables, batch refresh, transit planning)
* Static city dataset committed to `data/cities.json` and refreshed daily by GitHub Actions; the API can read it from the repo/CDN via `DATA_BASE_URL`
* Operational knobs: optional API key auth, CORS allow-list, per-IP rate limiting, request logging, caching headers, graceful error codes
* Full API reference in `docs/API.md`

### BREAKING CHANGES

* Package renamed from `chelaile-mcp-server` to `chelaile-api-server`; the default entrypoint (`chelaile-api` bin / `npm start`) is now the HTTP API. The MCP server is still shipped and can be started with the `chelaile-mcp-server` bin or `npm run start:mcp`.

## 1.1.0 (2026-05-18)

### Features

* initial chelaile-mcp-server ([24e0444](https://github.com/PeanutSplash/chelaile-mcp/commit/24e0444b6bbb48afcae1a7eef68e5fb248398faa))
