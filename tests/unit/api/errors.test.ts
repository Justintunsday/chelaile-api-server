import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  ApiError,
  methodNotAllowed,
  notFound,
  rateLimited,
  toApiError,
  unauthorized,
  validationError,
} from "../../../src/api/errors.js";

describe("ApiError", () => {
  test("serialises to the documented error shape", () => {
    const error = new ApiError(418, "teapot", "I'm a teapot", {
      hint: "use a coffee machine",
      details: [{ param: "x" }],
    });
    expect(error.toBody()).toEqual({
      error: {
        code: "teapot",
        message: "I'm a teapot",
        hint: "use a coffee machine",
        details: [{ param: "x" }],
      },
    });
  });

  test("omits hint and details when absent", () => {
    expect(new ApiError(500, "boom", "Boom").toBody()).toEqual({
      error: { code: "boom", message: "Boom" },
    });
  });
});

describe("validationError", () => {
  test("maps zod issues to param/message pairs", () => {
    const schema = z.object({ lat: z.string().regex(/^\d+$/) });
    const result = schema.safeParse({ lat: "abc" });
    if (result.success) throw new Error("expected failure");
    const apiError = validationError(result.error);
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe("invalid_params");
    const details = apiError.details as { param: string; message: string }[];
    expect(details[0].param).toBe("lat");
  });
});

describe("error factories", () => {
  test("notFound / methodNotAllowed / unauthorized / rateLimited", () => {
    expect(notFound("/x").status).toBe(404);
    expect(methodNotAllowed("POST", "/x").status).toBe(405);
    expect(unauthorized().status).toBe(401);
    expect(rateLimited(60).status).toBe(429);
    expect(rateLimited(60).hint).toContain("60");
  });
});

describe("toApiError", () => {
  test("passes ApiError through unchanged", () => {
    const original = new ApiError(400, "invalid_params", "nope");
    expect(toApiError(original)).toBe(original);
  });

  test("maps timeouts to 504", () => {
    const error = toApiError(new Error("Request timed out after 15000ms"));
    expect(error.status).toBe(504);
    expect(error.code).toBe("upstream_timeout");
  });

  test("maps everything else to 502", () => {
    const error = toApiError(new Error("Upstream response missing jsonr.data"));
    expect(error.status).toBe(502);
    expect(error.code).toBe("upstream_error");
  });

  test("handles non-Error throwables", () => {
    const error = toApiError("plain string failure");
    expect(error.status).toBe(502);
    expect(error.message).toBe("plain string failure");
  });
});
