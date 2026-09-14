# 车来了 HTTP API 使用文档

`chelaile-api-server` 把原先只支持 MCP（stdio）的车来了实时公交能力，封装为一套只读的 HTTP JSON API。
无需登录、无需账号、无需上游 Key，启动即用。

- 默认地址：`http://127.0.0.1:8787`
- 所有业务端点均在 `/v1` 前缀下，全部使用 `GET`（另有 `HEAD`、`OPTIONS` 支持）
- 响应统一为 JSON（UTF-8）
- 端点索引：`GET /` 或 `GET /v1`

---

## 目录

- [1. 快速开始](#1-快速开始)
- [2. 通用约定](#2-通用约定)
- [3. 端点参考](#3-端点参考)
  - [基础信息](#31-基础信息)
  - [地理与定位](#32-地理与定位)
  - [搜索](#33-搜索)
  - [站点](#34-站点)
  - [线路](#35-线路)
  - [换乘规划](#36-换乘规划)
- [4. 静态数据托管在 GitHub](#4-静态数据托管在-github)
- [5. 部署](#5-部署)
- [6. 环境变量](#6-环境变量)
- [7. 常见问题](#7-常见问题)
- [8. 与 MCP 版本的关系](#8-与-mcp-版本的关系)

---

## 1. 快速开始

### 从源码运行

```bash
git clone https://github.com/Justintunsday/chelaile-api-server.git
cd chelaile-api-server
npm install
npm run build
npm start
# chelaile-api v2.0.0 listening on http://0.0.0.0:8787 (data: ./data)
```

### 第一个请求

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

### 查询"71 路还有多久到"

```bash
# 1. 找到你需要的数据（城市 ID、线路 ID、站点 ID、站点序号）
curl "http://127.0.0.1:8787/v1/search?city_id=034&keyword=71"

# 2. 查询实时到站
curl "http://127.0.0.1:8787/v1/lines/realtime?city_id=034&line_id=21283603183&target_order=2&station_id=021-15232&lat=31.2304&lng=121.4737"
```

---

## 2. 通用约定

### 2.1 认证

默认不启用。设置环境变量 `API_KEY` 后，所有 `/v1/*` 请求必须携带以下任意一种凭证：

| 方式 | 示例 |
| --- | --- |
| 请求头 `X-API-Key` | `curl -H "X-API-Key: <key>" ...` |
| Bearer Token | `curl -H "Authorization: Bearer <key>" ...` |
| 查询参数 | `curl "...?key=<key>"` |

缺失或错误凭证返回 `401 unauthorized`。`GET /`（端点索引）不受保护。

### 2.2 CORS

- 默认 `CORS_ORIGIN=*`，允许任意来源的浏览器请求。
- 也可配置为白名单（逗号分隔）：`CORS_ORIGIN=https://a.com,https://b.com`。
- 非白名单来源返回 `403 origin_not_allowed`，预检请求（`OPTIONS`）返回 `204`。

### 2.3 限流

默认关闭。设置 `RATE_LIMIT_PER_MINUTE` 后按客户端 IP 做每分钟固定窗口限流，超出返回
`429 rate_limited` 并带 `Retry-After: 60`。反向代理场景请确保透传 `X-Forwarded-For`。

### 2.4 错误格式

```json
{
  "error": {
    "code": "invalid_params",
    "message": "One or more request parameters are invalid.",
    "details": [{ "param": "lat", "message": "must be a decimal number, e.g. '31.230416'" }]
  }
}
```

| HTTP | code | 说明 |
| --- | --- | --- |
| 400 | `invalid_params` | 参数缺失、格式错误、越界 |
| 401 | `unauthorized` | 已启用 API Key 但未提供 / 不正确 |
| 403 | `origin_not_allowed` | 来源不在 CORS 白名单 |
| 404 | `not_found` | 路径不存在 |
| 405 | `method_not_allowed` | 使用了非 GET/HEAD/OPTIONS 方法 |
| 429 | `rate_limited` | 触发限流 |
| 502 | `upstream_error` | 上游返回异常或响应无法解析 |
| 504 | `upstream_timeout` | 上游超时（默认 15s） |

### 2.5 坐标系（重要）

上游对不同的接口要求不同的坐标系，传错会导致**查询结果位置偏差几百米**：

| 坐标系 | 使用场景 |
| --- | --- |
| **WGS-84** | `/v1/stops/nearby`、`/v1/lines/realtime`、`/v1/lines/detail`（lat/lng 可选）、`/v1/reverse-geocode` 的入参；`stations[].lat/lng`、`wgsLat/wgsLng` 均为 WGS-84 |
| **GCJ-02** | `/v1/transit/plan` 的入参；`/v1/search` 返回的 `pois[].lat/lng` 为 GCJ-02 |

若手上只有 WGS-84 且需要 GCJ-02（或反向转换），请先做坐标转换再调用。

### 2.6 常用字段说明

| 字段 | 含义 |
| --- | --- |
| `capacity` | 车厢拥挤度：`0` 宽松、`1` 适中、`2` 拥挤 |
| `arrivalTime` | 毫秒级 Unix 时间戳；`-1` 表示未知 |
| `travelTime` | 距离目标站剩余秒数；`-1` 表示未知 |
| `eta` | `{ travelTime, arrivalTime, displayTime? }`，仅最近一辆驶向目标站的车辆有值，其余为 `null` |
| `isSubway` | 是否为地铁线路 |
| `distance` | 米；部分场景缺失 |
| 时间字段 | 均为北京时间（上游当地时区） |

### 2.7 缓存

| 端点 | `Cache-Control` |
| --- | --- |
| `/v1/cities` | `public, max-age=3600`（`live=true` 时为 `no-store`） |
| `/v1/cities/config` | `public, max-age=600` |
| `/v1/reverse-geocode` | `public, max-age=86400` |
| `/v1/lines/route`、`/v1/lines/timetable` | `public, max-age=86400 / 3600` |
| 实时类端点 | `no-store` |

CDN / 浏览器会遵循以上缓存策略；如需强制最新实时数据，实时端点本身不缓存。

---

## 3. 端点参考

### 3.1 基础信息

#### GET /v1/health

存活探针，无参数。

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

支持城市列表。默认直接从 `data/cities.json`（可由 GitHub 托管）读取，避免每次请求上游。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `hot_only` | boolean | `true` | 只返回热门城市（约 12 个）。`false` 返回全部约 480 个 |
| `live` | boolean | `false` | `true` 时忽略本地/远程数据集，直接回源上游 |

boolean 参数接受 `true/false`、`1/0`。

响应字段：

| 字段 | 说明 |
| --- | --- |
| `origin` | 数据来源：`file`（本地文件）、`github`（`DATA_BASE_URL`）、`upstream`（实时上游） |
| `updatedAt` | 数据集快照时间 |
| `count` / `total` | 过滤后数量 / 数据集总数 |
| `cities[]` | `{ cityId, cityName, pinyin?, supportSubway, hot }` |

#### GET /v1/cities/config

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID，如 `034`（上海）、`027`（北京） |

```json
{
  "maxInterval": 30,
  "arrivingStationLimitSeconds": 180,
  "busDisplayConfig": { "lineDetail": "time#order#distance", "other": "time#order" }
}
```

### 3.2 地理与定位

#### GET /v1/reverse-geocode

WGS-84 经纬度 → 中文地址。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `lat` | number string | 是 | WGS-84 纬度，如 `31.230416` |
| `lng` | number string | 是 | WGS-84 经度，如 `121.473701` |

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

> 直辖市上游返回空 `city`，本项目会自动回填为 `province`。

#### GET /v1/my-location

按 IP 估算位置，精度为城市级（约 10 km），不足以定位公交站。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ip` | string | 否 | 指定要查询的 IP；省略时使用**服务器出口 IP**，因此部署在中国大陆的服务器结果最准确 |

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

境外 IP（常见于 VPN / 代理出口）会附带 `warning` 字段并且 `inChina: false`。

### 3.3 搜索

#### GET /v1/search

在同一城市内按关键词混合搜索：线路、站点、POI。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID |
| `keyword` | string | 是 | 关键词，如 `71`、`71路`、`地铁2号线`、`陆家嘴`、`人民广场` |

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

要点：

- 同一条线路的上下行被折叠进 `directions[]`，顶层 `lineId/direction/startSn/endSn` 为下行（direction=0）兼容字段。
- `isSubway: true` 的线路 ID 不支持 `/v1/lines/detail`（返回 `empty: true`），请改用 `/v1/stops/detail` 或 `/v1/transit/plan`。
- `stations[].lat/lng` 为 WGS-84，`pois[].lat/lng` 为 GCJ-02。

#### GET /v1/search/more

分页"查看更多"，与 `/v1/search` 同参，另加：

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `type` | `"1" \| "2" \| "3"` | `"1"` | `1` 更多线路、`2` 更多站点、`3` 更多 POI |

### 3.4 站点

#### GET /v1/stops/nearby

坐标附近的站点 + 每条线路的实时到站。

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `city_id` | string | 是 | | 城市 ID |
| `lat` | number string | 是 | | WGS-84 纬度 |
| `lng` | number string | 是 | | WGS-84 经度 |
| `limit` | integer | 否 | `5` | 返回最近多少个站点，范围 1–20 |

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

- `lines[].targetOrder` + `lines[].targetStationId` + `lineId` 可直接组成 `/v1/lines/realtime` 的请求。
- 无实时车辆但即将发车时，`preArrivalTime` 为预计发车时间（`HH:MM`）。

#### GET /v1/stops/detail

某个物理站台经过的全部线路、实时车辆与附近地铁。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID |
| `physical_st_id` | string | 是 | 来自 `/v1/stops/nearby` 或 `/v1/search` |
| `namesake_st_id` | string | 否 | 来自同一来源，建议携带 |
| `first_line_id` | string | 否 | 高亮某条线路 |
| `lat` / `lng` | number string | 否 | 传入后返回 `distance` |

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

`stations[]` 中出现多项表示该站名对应多个物理站台。

### 3.5 线路

#### GET /v1/lines/detail

线路完整信息：首末班、票价、全部站点、当前在线车辆、反向 lineId。

> **地铁线路不支持**：会返回 `empty: true` 与 `hint`。地铁请用 `/v1/stops/detail` 或 `/v1/transit/plan`。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID |
| `line_id` | string | 是 | 线路 ID（来自 `/v1/search`） |
| `lat` / `lng` | number string | 否 | WGS-84，可选 |

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

线路轨迹坐标，用于地图画线。

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID |
| `line_id` | string | 是 | 线路 ID |
| `include_shape` | boolean | `false` | `false` 仅返回站点标记（约 25 点）；`true` 返回全部形状点（约 400–500 点） |

```json
{
  "pointCount": 480,
  "stopCount": 23,
  "points": [{ "lat": 31.23, "lng": 121.49, "stopOrder": 1 }]
}
```

> 上游偶尔缺少终点站标记，`stopCount` 可能比 `/v1/lines/detail` 的 `stationsNum` 少 1，画线无碍。

#### GET /v1/lines/realtime

"我的公交还有多久到站"——查询驶向指定站点的车辆实时信息。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID |
| `line_id` | string | 是 | 线路 ID |
| `target_order` | integer string | 是 | 等待站点在线路上的序号（来自 `line_detail.stations[].order` 或 `stops/nearby.lines[].targetOrder`） |
| `station_id` | string | 是 | 等待站点的 `sId`（来自 `stops/nearby.lines[].targetStationId` 或 `stations[].sId`） |
| `lat` / `lng` | number string | 是 | WGS-84；不知道用户位置时可直接使用站点坐标 |

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

> 上游只为**最近一辆**驶向目标站的车辆计算 `eta`，其余车辆 `eta` 为 `null`，这是正常现象。

#### GET /v1/lines/buses

锚定站点最快到达的一两辆车（"即将到站"场景）。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID |
| `line_id` | string | 是 | 线路 ID |
| `target_order` | integer string | 是 | 等待站点序号 |
| `station_name` | string | 是 | 等待站点名称（用于展示） |

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

线路发车时刻表，仅少数线路有逐班数据（上海多数线路为固定间隔）。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID |
| `line_id` | string | 是 | 线路 ID |
| `line_no` | string | 是 | **面向乘客的短名**（`search.lines[].name`，如 `71`），不是内部 `lineNo`（如 `r95817`） |
| `direction` | `"0" \| "1"` | 是 | 方向 |

```json
{
  "line": { "lineId": "21283603183", "name": "71", "direction": 0, "startSn": "...", "endSn": "..." },
  "timeTableType": 2,
  "mode": "interval",
  "timetable": null,
  "note": "This line runs at a fixed interval — the upstream does not return per-trip departure times. ..."
}
```

`mode` 取值：`scheduled`（逐班时刻）、`interval`（固定间隔）、`special`、`unknown`。

> 查询"首末班 / 是否还在运营"请优先用 `/v1/lines/detail`，它的 `firstTime/lastTime` 更可靠。

#### GET /v1/lines/refresh

一次请求批量刷新多个 (线路, 站点) 组合，适合做"收藏线路"看板。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID |
| `line_stn` | string | 是 | 四元组列表：`lineId,stopId,nextId,targetOrder`，多条以 `;` 分隔，`nextId` 可为空。建议不超过 10 条 |

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

### 3.6 换乘规划

#### GET /v1/transit/plan

公交 + 地铁换乘规划，返回多个候选方案。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `city_id` | string | 是 | 城市 ID |
| `origin_name` | string | 是 | 起点名称（展示用） |
| `origin_lat` / `origin_lng` | number string | 是 | 起点坐标，**GCJ-02** |
| `dest_name` | string | 是 | 终点名称 |
| `dest_lat` / `dest_lng` | number string | 是 | 终点坐标，**GCJ-02** |
| `strategy` | `"0" \| "1" \| "2" \| "3"` | 否 | `0` 推荐（默认，含地铁）、`1` 少换乘、`2` 少步行、`3` 最短时间（**上游常排除地铁方案**） |

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

`lineType`：`0` 公交、`1` 地铁；时间单位为秒，距离单位为米。

---

## 4. 静态数据托管在 GitHub

实时接口必须回源上游，但**城市列表这类低频变化的数据**适合静态化：本仓库通过 GitHub 托管
`data/cities.json`，API 进程默认直接读取该文件，不再每次请求上游。

### 4.1 数据文件

`data/cities.json`（由脚本生成，可提交到仓库；`updatedAt` 仅在城市列表内容变化时更新）：

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

### 4.2 手动同步

```bash
npm run sync-data               # 写入 data/cities.json（tsx）
bun scripts/sync-data.ts        # 或直接用 Bun 运行
bun scripts/sync-data.ts out.json --force   # 指定输出文件 / 跳过骤减保护
```

### 4.3 GitHub Actions 自动同步

仓库已包含 `.github/workflows/sync-data.yml`（工作流名 **Sync data**）：

| 触发方式 | 说明 |
| --- | --- |
| 定时 | 每天 `03:17 UTC`（北京时间 11:17）自动运行 |
| 手动 | Actions → Sync data → Run workflow；可勾选 `force` 跳过骤减保护 |
| Push | 修改 `scripts/sync-data.ts`、工作流本身、`package.json` 或 `bun.lock` 时立即运行一次 |

脚本内置的可靠性措施：

- **失败重试**：拉取上游最多重试 3 次（指数退避）
- **下限保护**：返回城市数少于 50 个直接失败，不覆盖数据集
- **骤减保护**：新城市数比现有数据集减少超过 40% 时拒绝提交，需手动触发并勾选 `force`
- **幂等提交**：城市列表内容无变化时不重写文件、不产生提交（不会出现仅时间戳变化的提交）
- **并发安全**：push 被并发运行拒绝时自动 rebase 重试（最多 3 次）
- **运行摘要**：每次运行在 Actions 页面输出城市数、热门城市数、是否提交

工作流使用 Bun（与仓库的 `bun.lock` 一致），首次使用需要在仓库
**Settings → Actions → General → Workflow permissions** 中选择 **Read and write permissions**，
否则 `git push` 会被拒绝。

### 4.4 从 GitHub / CDN 读取数据

部署 API 时可通过 `DATA_BASE_URL` 指定数据集的 HTTP 目录（例如同一个仓库的 raw 地址或 jsDelivr）：

```bash
# GitHub raw（不建议高并发，仅适合小流量）
DATA_BASE_URL="https://raw.githubusercontent.com/Justintunsday/chelaile-api-server/main/data"

# jsDelivr（有 CDN 缓存，推荐）
DATA_BASE_URL="https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data"
```

API 会请求 `${DATA_BASE_URL}/cities.json`。

### 4.5 数据加载优先级

```
内存缓存（CITIES_CACHE_TTL_MS，默认 6 小时）
  └─ 1. DATA_BASE_URL（GitHub/CDN，如配置）
  └─ 2. 本地文件 DATA_DIR/cities.json
  └─ 3. 回源上游 /wwd/ncitylist（兜底）
```

`GET /v1/cities?live=true` 始终绕过上述缓存直接回源，并在响应的 `origin` 中返回 `upstream`。

---

## 5. 部署

### 5.1 Node 直接运行

```bash
npm ci
npm run build
PORT=8787 DATA_BASE_URL="https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data" npm start
```

进程管理建议使用 `systemd` / `pm2` / `docker restart=always`。

### 5.2 Docker

```bash
docker build -t chelaile-api .
docker run -d --name chelaile-api -p 8787:8787 \
  -e DATA_BASE_URL="https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data" \
  -e API_KEY="your-secret" \
  chelaile-api
```

镜像内已包含构建产物与 `data/` 数据集。

### 5.3 托管平台（从 GitHub 一键部署）

> **GitHub Pages / GitHub Actions 不能直接充当 API 服务器。** Pages 只能托管静态文件，
> 无法执行上游请求、MD5 签名与 AES 解密；Actions 无法暴露常驻公网端口。本仓库用
> Pages 托管使用文档，用 Actions 定时更新数据集；API 进程需部署到下方平台。

| 平台 | 部署方式 | 说明 |
| --- | --- | --- |
| **Vercel** | vercel.com/new 导入本仓库 | 仓库 `vercel.json` 已声明 **Services + container**（构建 Dockerfile 并将全路径转发给服务），无需手动设置 Framework Preset；已实际部署验证 |
| **Render** | 一键 Blueprint：<https://render.com/deploy?repo=https://github.com/Justintunsday/chelaile-api-server> | 读取仓库 `render.yaml` + Dockerfile；免费套餐需银行卡验证，且 15 分钟无请求休眠 |
| **Railway** | New Project → Deploy from GitHub repo | 自动读取 `railway.json` 与 Dockerfile |
| **VPS** | `npm ci && npm run build && npm start` 或 Docker | 完全可控，可用 systemd/pm2 守护 |
| **GitHub Codespaces（临时）** | Code → Codespaces，`npm ci && npm run build && npm start`，将 8787 端口改为 Public | 仅用于临时测试，会休眠且有免费额度限制 |

- **建议部署在中国大陆或就近区域**：`/v1/my-location` 使用服务器出口 IP，且回源 `web.chelaile.net.cn` 时大陆网络更稳定。
- **Vercel 环境变量**：建议在项目 Production 环境设置 `DATA_BASE_URL=https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data`，否则 `/v1/cities` 会回源上游。
- **超时**：上游单次请求超时 15s；Serverless 类平台请确保函数超时 ≥ 20s（Vercel 容器服务不受旧版 `functions.maxDuration` 配置影响，该项目已改用 Services 模式）。

### 5.4 反向代理

Nginx 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

透传 `X-Forwarded-For` 可让限流与日志拿到真实客户端 IP。

---

## 6. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `CORS_ORIGIN` | `*` | 允许来源，多个用逗号分隔；`*` 为全部 |
| `API_KEY` | 未设置 | 设置后 `/v1/*` 需要 `X-API-Key` / Bearer / `?key=` |
| `RATE_LIMIT_PER_MINUTE` | `0`（关闭） | 每 IP 每分钟请求上限 |
| `DATA_DIR` | `./data` | 本地数据集目录 |
| `DATA_BASE_URL` | 未设置 | GitHub / jsDelivr 数据集地址（末尾无斜杠） |
| `CITIES_CACHE_TTL_MS` | `21600000`（6h） | 城市数据集内存缓存时长；`0` 表示不缓存 |
| `LOG_REQUESTS` | `true` | 是否打印访问日志 |

---

## 7. 常见问题

**Q：返回 `502 upstream_error` / `504 upstream_timeout`？**
上游 `web.chelaile.net.cn` 偶发不稳定。`504` 表示超过 15s 超时；重试通常即可。`502` 表示上游返回了
异常结构，可带上 `error.message` 反馈。

**Q：`/v1/lines/detail` 返回 `empty: true`？**
多半是地铁线路（本接口不覆盖地铁）或线路已停运。按响应中的 `hint` 改用 `/v1/stops/detail`
（地铁线路信息）或 `/v1/transit/plan`（换乘）。

**Q：为什么 `/v1/lines/realtime` 的 `eta` 大多是 `null`？**
上游只为最近一辆驶向目标站的车辆预测 ETA，其余车辆仍会返回位置、速度、拥挤度。

**Q：`physicalStId`、`sId`、`targetOrder` 有什么区别？**
`sId` 是"线路 × 站点"的站点实例 ID，用于实时查询；`physicalStId` 是物理站台 ID，用于站点详情；
`targetOrder` 是站点在线路上的序号。`/v1/stops/nearby` 与 `/v1/search` 会同时返回这三者。

**Q：为什么换乘规划要求 GCJ-02，而其他接口要求 WGS-84？**
这是上游接口的约定。搜索返回的 POI 坐标本身就是 GCJ-02，可直接用于 `/v1/transit/plan`。

**Q：`/v1/my-location` 定位不准？**
IP 定位精度本身就是城市级；VPN/代理会返回出口 IP 所在地。部署在大陆的服务器使用省略 `ip` 的
调用才会返回调用方（服务器）的位置。

**Q：数据可以商用吗？**
本项目仅对上游公开接口做协议适配，仅供学习研究，请遵守上游服务条款，避免高频抓取与商业使用。

---

## 8. 与 MCP 版本的关系

原 MCP 能力全部保留：同一份代码同时提供 HTTP API 与 MCP stdio 服务，共 15 个工具
（`bus_list_cities`、`bus_search`、`bus_get_nearby_stops`、`bus_get_line_realtime`、`bus_plan_transit` …）。

启动 MCP 服务：

```bash
npm run start:mcp
# 或
node dist/index.js
```

在 Claude Code / Claude Desktop 中仍可注册（命令指向本地构建产物或包名）：

```json
{
  "mcpServers": {
    "chelaile": { "command": "npx", "args": ["-y", "chelaile-mcp-server"] }
  }
}
```

MCP 工具与 HTTP 端点的对应关系：

| MCP 工具 | HTTP 端点 |
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
