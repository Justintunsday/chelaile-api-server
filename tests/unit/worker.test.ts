import { expect, test } from "bun:test";
import worker from "../../worker/index.js";

test("Worker preserves all API-key forms, alternate credentials and Unicode keys", async () => {
  for (const key of ["sekret", "密钥🔑"]) {
    const env = { API_KEY: key };
    // Unicode headers are not legal HTTP header bytes; query credentials are UTF-8.
    const requests = [new Request(`https://api.example/v1/health?key=${encodeURIComponent(key)}`)];
    if (key === "sekret") {
      requests.push(new Request("https://api.example/v1/health", { headers: { "x-api-key": key } }));
      requests.push(new Request("https://api.example/v1/health", { headers: { authorization: `Bearer ${key}` } }));
      requests.push(new Request(`https://api.example/v1/health?key=${key}`, { headers: { "x-api-key": "wrong" } }));
    }
    for (const request of requests) expect((await worker.fetch(request, env)).status).toBe(200);
    expect((await worker.fetch(new Request("https://api.example/v1/health?key=wrong"), env)).status).toBe(401);
    expect((await worker.fetch(new Request("https://api.example/"), env)).status).toBe(200);
  }
});

test("Worker city caches are scoped to DATA_BASE_URL and retain raw string IDs", async () => {
  const original = globalThis.fetch;
  const loads: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    loads.push(url);
    return Response.json({ cities: [{ cityId: url.includes("source-a") ? "0034" : "0027", cityName: "fixture", hot: true }] });
  }) as typeof fetch;
  try {
    const get = async (source: string) => {
      const response = await worker.fetch(new Request("https://api.example/v1/cities"), { DATA_BASE_URL: source });
      return await response.json() as { cities: { cityId: string }[] };
    };
    expect((await get("https://source-a.example/data/")).cities[0].cityId).toBe("0034");
    expect((await get("https://source-a.example/data")).cities[0].cityId).toBe("0034");
    expect(loads).toHaveLength(1);
    expect((await get("https://source-b.example/data")).cities[0].cityId).toBe("0027");
    expect(loads).toHaveLength(2);
  } finally { globalThis.fetch = original; }
});
