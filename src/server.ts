// Zero-config Node server entrypoint for platforms that auto-detect servers
// (e.g. Vercel looks for `server.ts` in the project root or `src/`).
// Local usage: `node dist/server.js` (same behavior as `npm start`).
import { createApp } from "./api/server.js";
import { loadConfig } from "./api/config.js";
import { API_NAME, API_VERSION } from "./api/version.js";

const config = loadConfig();
const app = createApp({ config });
const port = Number(process.env.PORT ?? config.port);

app.listen(port, () => {
  console.log(
    `${API_NAME} v${API_VERSION} listening on http://${config.host}:${port} ` +
      `(data: ${config.dataBaseUrl ?? config.dataDir})`,
  );
});
