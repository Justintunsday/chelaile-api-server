# Compatibility baseline and incremental review

Baseline: `8dca209` (2026-10-12). Before production edits: 226 unit tests,
TypeScript compilation and Wrangler dry-run passed. Frozen Bun installation
failed because `bun.lock` omitted existing Workers dependencies; `package-lock.json`
already contains them. Contract snapshots were captured before production edits.

## Public HTTP contract

All routes below use GET; HEAD dispatches the same handler and OPTIONS returns
204 before authentication. `/` and `/v1` expose the endpoint index. Trailing
slashes work in both runtimes; Node additionally tolerates repeated slashes.
Unknown query fields are ignored; duplicate query fields use the last value,
except authentication uses the first `key`. IDs remain strings including zeros.
Coordinates remain decimal strings: ordinary bus/geocoder calls use WGS-84;
transit inputs and upstream flags use GCJ-02. No coordinate conversion is added.

| Route under /v1 | Required query parameters | Optional parameters (default) | Successful JSON / cache |
| --- | --- | --- | --- |
| health | none | none | status, name, version, time, uptimeSeconds; no-store |
| cities | none | hot_only=true, live=false | origin, updatedAt, hotOnly, count, total, cities; 1h (live: no-store) |
| cities/config | city_id | none | maxInterval, arrivingStationLimitSeconds, busDisplayConfig; 10m |
| reverse-geocode | lat, lng | none | formatted, province, city, district, township, citycode, adcode; 1d |
| my-location | none | ip omitted | lat, lng, gpsType, city, region, country, ip, isp?, precision, warning?, inChina; no-store |
| search | city_id, keyword | none | highlightKey, lines, stations, pois; no-store |
| search/more | city_id, keyword | type="1" (1/2/3) | same search shape; no-store |
| stops/nearby | city_id, lat, lng | limit=5 (1..20) | stops; no-store |
| stops/detail | city_id, physical_st_id | namesake_st_id, first_line_id, lat, lng omitted | stations; no-store |
| lines/detail | city_id, line_id | lat, lng omitted | line, stations, buses, reverseDirection, depDesc?, preArrivalTime?, targetOrder?, empty?/hint?; no-store |
| lines/route | city_id, line_id | include_shape=false | pointCount, stopCount, points; 1d |
| lines/realtime | city_id, line_id, target_order, station_id, lat, lng | none | line, targetOrder, buses, realData, note; no-store |
| lines/buses | city_id, line_id, target_order, station_name | none | targetOrder, buses; no-store |
| lines/timetable | city_id, line_id, line_no, direction (0/1) | none | line, timeTableType, mode, timetable, note?; 1h |
| lines/refresh | city_id, line_stn | none | lines; no-store |
| transit/plan | city_id, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng | strategy="0" (0..3) | origin, destination, distance, plans, warning?; no-store |

The exact nested JSON, omitted fields, query ordering, signature values and
transport fingerprint are recorded in `tests/contracts/__snapshots__` using
controlled upstream responses; populated-domain fixtures remain in `tests/unit/tools`.
See [API.md](API.md) for complete nested field descriptions. Snapshot tests are
offline; they do not certify that an undocumented upstream still accepts requests.

Authentication is optional and applies to paths beginning `/v1`. All three
forms remain supported: X-API-Key, Bearer token, query `key`. An invalid header
does not suppress a valid alternate credential. Root remains public. Fixed-window
Node rate limiting is disabled by default (0), with 60-second windows per IP.
CORS defaults to `*`; an allow-list rejects disallowed origins; origin-free
requests are allowed. No CORS policy redesign is included.

Errors remain `{error:{code,message,hint?,details?}}`: 400 invalid_url /
invalid_params; 401 unauthorized; 403 origin_not_allowed; 404 not_found;
405 method_not_allowed; 429 rate_limited (`Retry-After: 60`);
502 upstream_error; 504 upstream_timeout. Upstream status/transport failures
use these existing codes. Public diagnostic wording is not an upstream protocol.

## MCP and runtime contract

`tests/contracts/mcp.contract.test.ts` records the actual MCP tools/list names,
input JSON schemas, defaults, strictness, descriptions and annotations for all
15 tools. Existing markdown / JSON output and isError behavior remain covered
by domain tests. Node >=18 runtime, Bun, Docker, stdio MCP and Workers remain
supported. Worker date `2026-09-01`, flags, domain routing, signatures,
AES-256-ECB, salts, parameter order and protocol headers are retained.

## Known differences and risks to preserve

- Worker index/health include `runtime`; Node omits it. Node my-location cache
  policy is `private, no-store`, Worker is `no-store`. Origin-free CORS headers
  differ. These differences are intentional baseline observations, not normalized.
- IP lookup without `ip` uses the server egress IP, despite the endpoint index
  saying caller location. The free upstream is HTTP-only. Do not change semantics
  or switch providers without a separate compatibility decision.
- Upstream envelope extraction assumes braces outside strings. A quoted brace
  may fail; preserve until real protocol fixtures establish the correct framing.
- Worker has no existing IP limiter. Node limiters are process-local; Workers
  caches are isolate-local and neither constitutes distributed coordination.
- Worker platform invocation logs / traces and reverse proxies may record raw
  request URLs independently of application logging. Prefer header credentials;
  query-key support is retained for compatibility.
- No live upstream or production deployment is implied by offline contracts.
  workerd smoke tests use bundled data. Docker is verified by CI rather than a
  local daemon. Scheduled departures are passed through when upstream provides
  them; timetable fixtures do not establish coverage for any particular city/line.

## Changes, operational notes and rollback

- Access logs now record method/path/status/duration, without query strings.
  Query-key authentication remains supported. Use X-API-Key to also avoid proxy
  and platform URL logs.
- Forwarded IPs are ignored by default. Set `TRUSTED_PROXY_IPS` to an explicit
  comma-separated list of immediate/chain proxy IPs you control; wildcards and
  non-IP values fail startup. The chain is walked from right to left until the
  first untrusted address. Proxies must append/overwrite forwarding headers.
  Existing proxy installations must configure this before re-enabling limits,
  otherwise clients behind a proxy share that proxy's limit. No automatic trust
  is inferred from a client header.
- Upstream non-2xx (including redirects) fail with the existing 502 code; no
  body or URL is placed in the transport error. Worker no longer follows
  redirects. Node retains 15s and Worker 20s/two-attempt settings for Chelaile;
  IP geolocation retains 15s/one attempt. Node timeout now bounds total request
  time as well as idle time. Wire and decoded bodies are capped at 16 MiB;
  unusually large legitimate payloads will fail and need a separately reviewed
  limit adjustment. No evidence was used to guess a different upstream protocol.
- Cacheable Node city loads share a pending promise, cleared after either
  result. TTL <=0 and live=true retain fresh-load behavior. Worker shares only
  completed plain data, scoped to the normalized source URL, with TTL starting
  at completion. Pending Worker I/O is deliberately not shared across requests:
  [Cloudflare request ownership](https://developers.cloudflare.com/workers/reference/how-workers-works/)
  makes a process-wide pending promise inappropriate. Rate-limit state remains
  process-local and can grow with active IP count; distributed quotas and a
  maximum-key policy are deferred to avoid inventing new rejection behavior.
- Pure dataset parsing and fixed-size SHA-256/timing-safe key comparison are
  shared. Bus domain logic and all upstream crypto remain intact. Existing
  Node/Worker CORS and HEAD-on-error differences are not normalized.
- `bun.lock` is regenerated from the repository's already committed npm lock,
  including the existing Wrangler dependency. `package-lock.json` and dependency
  ranges are unchanged; this reconciles the pre-existing version divergence
  between the two package managers. Frozen install is checked in CI. Node
  development tools use Node 22, while compiled production artifacts are tested
  on 18/20/22/24 and Bun. The existing Docker recipe is built and smoke-tested.
- CI uses pinned action commits, read-only permissions, offline unit/contract
  tests, compile/type checks, Worker dry-run, workerd/stdio/HTTP runtime smoke
  checks and Docker checks. Live E2E remains opt-in. The pre-existing sync-data
  push trigger is restricted to main so feature branch pushes cannot create
  unsolicited dataset commits; daily/manual sync behavior remains intact.

Commits are separable by baseline, security boundary, transport, cache and CI.
Before merge, closing the PR rolls back all proposed changes. After merge,
revert the PR (or the individual fix commits in reverse order), rebuild from
the matching lockfile and redeploy the previous artifact. No data migrations,
binding migrations or new secrets are required. Removing TRUSTED_PROXY_IPS
restores socket-only trust; do not restore unconditional forwarded-header trust
as a temporary workaround.

## Security review scope

High-confidence findings: Node query-key log exposure (medium); unauthenticated
clients can rotate X-Forwarded-For to evade enabled Node limiting (medium).
HTTP status handling, response-stream failure handling and bounded reads are
reliability / resource-hardening fixes. Constant upstream hosts, salts and AES
keys implement the upstream protocol and are not application credentials.

Review used the user-specified [Security Review](https://github.com/getsentry/skills/blob/main/skills/security-review/SKILL.md),
[TDD](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md),
[Workers Best Practices](https://github.com/cloudflare/skills/blob/main/skills/workers-best-practices/SKILL.md),
[Code Review](https://github.com/getsentry/skills/blob/main/skills/code-review/SKILL.md),
[Systematic Debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md)
and [Code Simplifier](https://github.com/getsentry/skills/blob/main/skills/code-simplifier/SKILL.md).
