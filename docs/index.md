---
title: Chelaile API Documentation
---

# Chelaile API (chelaile-api-server)

This page is hosted on **GitHub Pages**, which serves static files only. The API must call
`web.chelaile.net.cn`, sign requests with MD5, and decrypt responses with AES, so **the API cannot run on Pages**.
Deploy the repository to a platform that can run Node processes, then send requests to that deployment.

- [Full API guide](API.html)
- [User guide (GitHub Wiki)](https://github.com/Justintunsday/chelaile-api-server/wiki)
- [Deployment instructions (README)](https://github.com/Justintunsday/chelaile-api-server#deployment)
- Hosted service (previously verified): <https://chelaile-api-server.vercel.app>
- Source repository: <https://github.com/Justintunsday/chelaile-api-server>
- Static data (jsDelivr CDN): <https://cdn.jsdelivr.net/gh/Justintunsday/chelaile-api-server@main/data/cities.json>

## Try it locally

```bash
git clone https://github.com/Justintunsday/chelaile-api-server.git
cd chelaile-api-server
npm install && npm run build && npm start
curl "http://127.0.0.1:8787/v1/health"
```

## Deploy with Render

Open <https://render.com/deploy?repo=https://github.com/Justintunsday/chelaile-api-server>
and connect GitHub as prompted. The repository includes `render.yaml` and Dockerfile, so no build command is needed.
