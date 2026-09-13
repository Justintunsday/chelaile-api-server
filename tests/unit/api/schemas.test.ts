import { describe, expect, test } from "bun:test";
import {
  citiesQuery,
  lineRealtimeQuery,
  nearbyQuery,
  parseParams,
  searchQuery,
  transitQuery,
} from "../../../src/api/schemas.js";
import { ApiError } from "../../../src/api/errors.js";

describe("boolParam", () => {
  test("defaults when absent", () => {
    expect(parseParams(citiesQuery, {}).hot_only).toBe(true);
    expect(parseParams(citiesQuery, {}).live).toBe(false);
  });

  test("accepts true/false and 1/0", () => {
    expect(parseParams(citiesQuery, { hot_only: "false" }).hot_only).toBe(false);
    expect(parseParams(citiesQuery, { hot_only: "1" }).hot_only).toBe(true);
    expect(parseParams(citiesQuery, { hot_only: "0" }).hot_only).toBe(false);
  });

  test("rejects garbage", () => {
    expect(() => parseParams(citiesQuery, { hot_only: "maybe" })).toThrow();
  });
});

describe("nearbyQuery", () => {
  test("coerces and bounds limit", () => {
    const parsed = parseParams(nearbyQuery, {
      city_id: "034",
      lat: "31.23",
      lng: "121.47",
      limit: "10",
    });
    expect(parsed.limit).toBe(10);
    expect(parseParams(nearbyQuery, {
      city_id: "034",
      lat: "31.23",
      lng: "121.47",
    }).limit).toBe(5);
  });

  test("rejects out-of-range limits", () => {
    expect(() =>
      parseParams(nearbyQuery, {
        city_id: "034",
        lat: "31.23",
        lng: "121.47",
        limit: "99",
      }),
    ).toThrow();
  });

  test("rejects malformed coordinates", () => {
    expect(() =>
      parseParams(nearbyQuery, { city_id: "034", lat: "abc", lng: "121" }),
    ).toThrow();
  });
});

describe("parseParams", () => {
  test("throws ApiError with invalid_params for missing fields", () => {
    try {
      parseParams(searchQuery, { city_id: "034" });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).code).toBe("invalid_params");
    }
  });

  test("ignores unknown query parameters", () => {
    const parsed = parseParams(searchQuery, {
      city_id: "034",
      keyword: "71",
      utm_source: "test",
    });
    expect(parsed.keyword).toBe("71");
  });
});

describe("lineRealtimeQuery", () => {
  test("requires integer target_order", () => {
    const valid = {
      city_id: "034",
      line_id: "21283603183",
      target_order: "2",
      station_id: "021-15232",
      lat: "31.23",
      lng: "121.47",
    };
    expect(parseParams(lineRealtimeQuery, valid).target_order).toBe("2");
    expect(() =>
      parseParams(lineRealtimeQuery, { ...valid, target_order: "two" }),
    ).toThrow();
  });
});

describe("transitQuery", () => {
  test("strategy defaults to 0 and rejects out-of-range values", () => {
    const valid = {
      city_id: "034",
      origin_name: "a",
      origin_lat: "31.2",
      origin_lng: "121.4",
      dest_name: "b",
      dest_lat: "31.3",
      dest_lng: "121.5",
    };
    expect(parseParams(transitQuery, valid).strategy).toBe("0");
    expect(() =>
      parseParams(transitQuery, { ...valid, strategy: "9" }),
    ).toThrow();
  });
});
