import { describe, expect, test } from "bun:test";
import { Router } from "../../../src/api/router.js";

function buildRouter(): Router {
  const router = new Router();
  router.get("/", () => {});
  router.get("/v1/health", () => {});
  router.get("/v1/cities", () => {});
  router.get("/v1/cities/:cityId/config", () => {});
  router.add("POST", "/v1/things", () => {});
  return router;
}

describe("Router", () => {
  test("matches a static route", () => {
    const match = buildRouter().match("GET", "/v1/health");
    expect(match.type).toBe("matched");
  });

  test("normalises trailing slashes", () => {
    expect(buildRouter().match("GET", "/v1/health/").type).toBe("matched");
  });

  test("extracts path params", () => {
    const match = buildRouter().match("GET", "/v1/cities/034/config");
    if (match.type !== "matched") throw new Error("expected match");
    expect(match.params.cityId).toBe("034");
  });

  test("matches method-insensitively", () => {
    expect(buildRouter().match("get", "/v1/health").type).toBe("matched");
  });

  test("reports method_not_allowed when only the method differs", () => {
    expect(buildRouter().match("GET", "/v1/things").type).toBe(
      "method_not_allowed",
    );
  });

  test("reports not_found for unknown paths", () => {
    expect(buildRouter().match("GET", "/v1/nope").type).toBe("not_found");
  });

  test("does not confuse different segment counts", () => {
    expect(buildRouter().match("GET", "/v1/cities/034").type).toBe("not_found");
  });
});
