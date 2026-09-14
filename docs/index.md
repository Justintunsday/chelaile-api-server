---
title: 车来了 API 文档
---

# 车来了 API（chelaile-api-server）

本页由 **GitHub Pages** 托管。Pages 只能提供静态文件，而本项目的 API 需要请求上游
`web.chelaile.net.cn` 并做 MD5 签名与 AES 解密，所以 **API 本身无法运行在 Pages 上**。
请按下述方式把仓库部署到能运行 Node 进程的平台，再把请求发到部署地址。

- [完整 API 使用文档](API.html)
- [使用手册（GitHub Wiki）](https://github.com/Justintunsday/chelaile-api-server/wiki)
- [部署说明（README）](https://github.com/Justintunsday/chelaile-api-server#部署把仓库变成在线-api)
- 在线服务（已验证）：<https://chelaile-api-server.vercel.app>
- 仓库源码：<https://github.com/Justintunsday/chelaile-api-server>
- 静态数据（jsDelivr CDN）：<https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data/cities.json>

## 快速体验（本地）

```bash
git clone https://github.com/Justintunsday/chelaile-api-server.git
cd chelaile-api-server
npm install && npm run build && npm start
curl "http://127.0.0.1:8787/v1/health"
```

## 一键部署（Render，免费）

点击 <https://render.com/deploy?repo=https://github.com/Justintunsday/chelaile-api-server>
按提示连接 GitHub 即可创建服务；仓库内置 `render.yaml` 与 Dockerfile，无需填写构建命令。
