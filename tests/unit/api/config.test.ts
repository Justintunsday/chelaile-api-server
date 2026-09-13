import { describe, expect, test } from "bun:test";
import { DEFAULTS, loadConfig } from "../../../src/api/config.js";

describe("loadConfig", () => {
  test("applies defaults for an empty environment", () => {
    const config = loadConfig({});
    expect(config.host).toBe(DEFAULTS.HOST);
    expect(config.port).toBe(DEFAULTS.PORT);
    expect(config.corsOrigin).toBe("*");
    expect(config.apiKey).toBeNull();
    expect(config.rateLimitPerMinute).toBe(0);
    expect(config.dataDir).toBe(DEFAULTS.DATA_DIR);
    expect(config.dataBaseUrl).toBeNull();
    expect(config.citiesCacheTtlMs).toBe(DEFAULTS.CITIES_CACHE_TTL_MS);
    expect(config.logRequests).toBe(true);
  });

  test("reads overrides from the environment", () => {
    const config = loadConfig({
      HOST: "127.0.0.1",
      PORT: "9000",
      CORS_ORIGIN: "https://example.com",
      API_KEY: "sekret",
      RATE_LIMIT_PER_MINUTE: "120",
      DATA_DIR: "/srv/data",
      CITIES_CACHE_TTL_MS: "1000",
      LOG_REQUESTS: "false",
    });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(9000);
    expect(config.corsOrigin).toBe("https://example.com");
    expect(config.apiKey).toBe("sekret");
    expect(config.rateLimitPerMinute).toBe(120);
    expect(config.dataDir).toBe("/srv/data");
    expect(config.citiesCacheTtlMs).toBe(1000);
    expect(config.logRequests).toBe(false);
  });

  test("strips trailing slashes from DATA_BASE_URL", () => {
    const config = loadConfig({
      DATA_BASE_URL: "https://cdn.jsdelivr.net/gh/user/repo@main/data///",
    });
    expect(config.dataBaseUrl).toBe(
      "https://cdn.jsdelivr.net/gh/user/repo@main/data",
    );
  });

  test("treats blank values as unset", () => {
    const config = loadConfig({ API_KEY: "  ", DATA_BASE_URL: " " });
    expect(config.apiKey).toBeNull();
    expect(config.dataBaseUrl).toBeNull();
  });

  test("rejects invalid PORT", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow();
    expect(() => loadConfig({ PORT: "70000" })).toThrow();
  });

  test("rejects negative RATE_LIMIT_PER_MINUTE", () => {
    expect(() => loadConfig({ RATE_LIMIT_PER_MINUTE: "-1" })).toThrow();
  });
});
