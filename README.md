# 车来了 API（chelaile-api-server）

把[车来了](https://web.chelaile.net.cn)实时公交能力封装为**只读 HTTP JSON API**：
线路时刻、车辆实时位置、附近站点、关键词搜索、线路轨迹、公交+地铁换乘规划。
无需登录、无需账号、开箱即用；同时保留原 MCP 服务，可继续在 Claude Code / Cursor 中使用。

- **完整使用文档：[docs/API.md](docs/API.md)**
- 默认监听：`http://127.0.0.1:8787`
- 全部端点：`GET /`（返回端点索引）

## 特性

- **零配置**：不依赖上游账号或密钥
- **REST 化**：全部 `GET`，JSON 响应，字段已做扁平化整理（线路上下行折叠、坐标归一、噪声字段剔除）
- **双形态**：HTTP API + MCP stdio 服务共用同一套核心逻辑
- **静态数据上 GitHub**：城市列表等低频数据由 GitHub Actions 定时同步并从仓库/CDN 读取，减少回源
- **可运维**：可选 API Key、CORS 白名单、按 IP 限流、请求日志、健康检查

## 快速开始

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

## API 端点一览

| 端点 | 用途 |
| --- | --- |
| `GET /v1/health` | 存活探针 |
| `GET /v1/cities` | 支持的城市（默认热门，`hot_only=false` 全量） |
| `GET /v1/cities/config` | 城市刷新间隔与展示策略 |
| `GET /v1/reverse-geocode` | WGS-84 坐标 → 中文地址 |
| `GET /v1/my-location` | 按 IP 估算位置（城市级） |
| `GET /v1/search` | 关键词混合搜索：线路 + 站点 + POI |
| `GET /v1/search/more` | 某一分类分页"查看更多" |
| `GET /v1/stops/nearby` | 附近站点与实时到站 |
| `GET /v1/stops/detail` | 站点经过的全部线路 + 实时车辆 + 附近地铁 |
| `GET /v1/lines/detail` | 线路完整站点表 + 当前车辆（不含地铁线路） |
| `GET /v1/lines/route` | 线路轨迹坐标（画地图用） |
| `GET /v1/lines/realtime` | "我的公交还有多久到站"实时 ETA |
| `GET /v1/lines/buses` | 即将到站的最近车辆 |
| `GET /v1/lines/timetable` | 逐班时刻表（少数线路有） |
| `GET /v1/lines/refresh` | 批量刷新多个 (线路, 站点) |
| `GET /v1/transit/plan` | 公交 + 地铁换乘规划 |

参数、响应示例、坐标系约定、错误码等详见 **[docs/API.md](docs/API.md)**。

### 调用示例

```bash
# 查询 71 路实时到站（line_id / target_order / station_id 来自 /v1/search 或 /v1/stops/nearby）
curl "http://127.0.0.1:8787/v1/lines/realtime?city_id=034&line_id=21283603183&target_order=2&station_id=021-15232&lat=31.2304&lng=121.4737"
```

```bash
# 人民广场 → 虹桥火车站 换乘规划（GCJ-02 坐标，可取自 /v1/search 的 pois）
curl "http://127.0.0.1:8787/v1/transit/plan?city_id=034&origin_name=人民广场&origin_lat=31.233021&origin_lng=121.49073&dest_name=虹桥火车站&dest_lat=31.197&dest_lng=121.327&strategy=0"
```

## 数据托管在 GitHub

`data/cities.json` 由脚本从上游拉取并提交到仓库；`.github/workflows/sync-data.yml`
每天 `03:17 UTC` 自动更新（内置 3 次重试、城市数异常骤减保护、无变化不产生提交），
修改同步脚本时也会自动运行，也可在 Actions 页面手动触发。API 读取优先级：

```
内存缓存 → DATA_BASE_URL（GitHub raw / jsDelivr）→ 本地 data/cities.json → 回源上游
```

```bash
npm run sync-data   # 手动同步城市列表
```

部署时指向你的仓库（jsDelivr 有 CDN 缓存，推荐）：

```bash
DATA_BASE_URL="https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data" npm start
```

> 首次使用工作流需在仓库 **Settings → Actions → General → Workflow permissions** 开启
> **Read and write permissions**。

## 部署（把仓库变成在线 API）

> **GitHub Pages / Actions 本身不能当这个 API 的服务器。** Pages 只提供静态文件，无法向
> 上游发请求、做 MD5 签名和 AES 解密；Actions 也无法暴露常驻公网端口。仓库里的
> `pages.yml` 只用来托管 **使用文档**：https://justintunsday.github.io/chelaile-api-server/

正确姿势是让仓库作为「部署源」，由平台自动构建并运行：

| 平台 | 方式 | 特点 |
| --- | --- | --- |
| **Vercel** | vercel.com/new 导入本仓库（仓库内 `vercel.json` 已声明 Services + 容器构建） | 已实际部署验证：https://chelaile-api-server.vercel.app |
| **Render** | 点击部署按钮（读取仓库内 `render.yaml`） | 免费套餐；但注册需银行卡验证；15 分钟无请求休眠 |
| **Railway** | 新建项目 → 选择本仓库（自动读取 `railway.json`） | 试用额度；无冷启动 |
| **VPS / Docker** | `docker build -t chelaile-api . && docker run -d -p 8787:8787 chelaile-api` | 完全可控，推荐生产 |
| **Codespaces（临时）** | 仓库 → Code → Codespaces 启动，`npm ci && npm run build && npm start`，把 8787 端口设为 Public | 获得临时公网地址，仅用于测试 |

Vercel 部署说明：仓库 `vercel.json` 使用新的 **Services** 配置（`runtime: "container"` + 全路径 rewrite），
直接 Import 仓库即可构建 Dockerfile；不需要手动改 Framework Preset。生产环境变量建议加
`DATA_BASE_URL=https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data`。

Render 一键部署：<https://render.com/deploy?repo=https://github.com/Justintunsday/chelaile-api-server>

Docker 用户可用：

```bash
docker build -t chelaile-api .
docker run -d --name chelaile-api -p 8787:8787 chelaile-api
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `CORS_ORIGIN` | `*` | 允许来源，逗号分隔 |
| `API_KEY` | 未设置 | 设置后 `/v1/*` 需携带 `X-API-Key` / Bearer / `?key=` |
| `RATE_LIMIT_PER_MINUTE` | `0` | 每 IP 每分钟请求上限（0 = 关闭） |
| `DATA_DIR` | `./data` | 本地数据集目录 |
| `DATA_BASE_URL` | 未设置 | GitHub / jsDelivr 数据集地址 |
| `CITIES_CACHE_TTL_MS` | `21600000` | 城市数据内存缓存时长 |
| `LOG_REQUESTS` | `true` | 访问日志开关 |

## MCP 服务（可选）

原 MCP 能力完整保留，启动方式：

```bash
npm run start:mcp   # node dist/index.js
```

在 Claude Code / Claude Desktop 中使用（15 个工具，`bus_*` 前缀），与 HTTP 端点的对应关系见
[docs/API.md](docs/API.md#8-与-mcp-版本的关系)。

## 开发

```bash
npm run dev          # tsx 热重载 API
npm run build        # tsc 构建
npm test             # 单元测试（bun test tests/unit）
npm run test:e2e     # 端到端测试（需外网，CHELAILE_E2E=1）
npm run sync-data    # 同步城市数据
```

## License

MIT

> 数据来源于车来了公开接口，本项目仅做协议适配，仅供学习研究使用；请遵守上游服务条款，
> 避免高频抓取与商业使用。
