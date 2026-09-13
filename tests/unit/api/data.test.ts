import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CityStore,
  filterCities,
  parseCityDataset,
} from "../../../src/api/data.js";
import type { LeanCity } from "../../../src/tools/city.js";

const CITIES: LeanCity[] = [
  { cityId: "034", cityName: "上海", supportSubway: true, hot: true },
  { cityId: "027", cityName: "北京", supportSubway: true, hot: true },
  { cityId: "100", cityName: "鄂尔多斯", supportSubway: false, hot: false },
];

const DATASET = {
  updatedAt: "2026-01-01T00:00:00.000Z",
  source: "chelaile:/wwd/ncitylist",
  count: CITIES.length,
  cities: CITIES,
};

describe("parseCityDataset", () => {
  test("parses a well-formed dataset", () => {
    const parsed = parseCityDataset(DATASET);
    expect(parsed?.cities).toHaveLength(3);
    expect(parsed?.cities[0].cityName).toBe("上海");
    expect(parsed?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("rejects missing / empty city lists", () => {
    expect(parseCityDataset(null)).toBeNull();
    expect(parseCityDataset({})).toBeNull();
    expect(parseCityDataset({ cities: [] })).toBeNull();
  });

  test("drops malformed city entries", () => {
    const parsed = parseCityDataset({
      cities: [
        { cityId: "034", cityName: "上海" },
        { cityId: "", cityName: "broken" },
        { cityName: "no id" },
        "not an object",
      ],
    });
    expect(parsed?.cities).toHaveLength(1);
    expect(parsed?.cities[0].cityName).toBe("上海");
    expect(parsed?.cities[0].hot).toBe(false);
    expect(parsed?.cities[0].supportSubway).toBe(false);
  });
});

describe("filterCities", () => {
  test("hotOnly keeps only hot cities", () => {
    expect(filterCities(CITIES, true).map((c) => c.cityId)).toEqual([
      "034",
      "027",
    ]);
  });

  test("hotOnly=false keeps everything", () => {
    expect(filterCities(CITIES, false)).toHaveLength(3);
  });
});

describe("CityStore", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "chelaile-data-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("prefers the remote (GitHub/CDN) dataset when configured", async () => {
    const store = new CityStore({
      dataDir: join(dir, "missing"),
      dataBaseUrl: "https://cdn.example/chelaile/data",
      ttlMs: 1000,
      fetchImpl: async () =>
        new Response(JSON.stringify(DATASET), { status: 200 }),
      fetchUpstream: async () => {
        throw new Error("upstream should not be called");
      },
    });
    const { origin } = await store.getEntry();
    const served = await store.servedCities(true);
    expect(origin).toBe("github");
    expect(served.count).toBe(2);
    expect(served.total).toBe(3);
    expect(served.hotOnly).toBe(true);
  });

  test("falls back to the local file when the remote dataset fails", async () => {
    const fileDir = await mkdtemp(join(tmpdir(), "chelaile-file-"));
    await writeFile(
      join(fileDir, "cities.json"),
      JSON.stringify(DATASET),
      "utf-8",
    );
    const store = new CityStore({
      dataDir: fileDir,
      dataBaseUrl: "https://cdn.example/chelaile/data",
      ttlMs: 1000,
      fetchImpl: async () => {
        throw new Error("cdn down");
      },
      fetchUpstream: async () => {
        throw new Error("upstream should not be called");
      },
    });
    const { origin } = await store.getEntry();
    expect(origin).toBe("file");
    await rm(fileDir, { recursive: true, force: true });
  });

  test("falls back to upstream when neither remote nor local data exists", async () => {
    let calls = 0;
    const store = new CityStore({
      dataDir: join(dir, "missing"),
      dataBaseUrl: null,
      ttlMs: 1000,
      fetchUpstream: async () => {
        calls++;
        return { cities: CITIES };
      },
    });
    const { origin } = await store.getEntry();
    expect(origin).toBe("upstream");
    expect(calls).toBe(1);
  });

  test("caches results for the configured TTL", async () => {
    let calls = 0;
    const store = new CityStore({
      dataDir: join(dir, "missing"),
      dataBaseUrl: null,
      ttlMs: 60_000,
      fetchUpstream: async () => {
        calls++;
        return { cities: CITIES };
      },
    });
    await store.getEntry();
    await store.getEntry();
    expect(calls).toBe(1);
  });

  test("live=true bypasses the cache and forces upstream", async () => {
    let calls = 0;
    const store = new CityStore({
      dataDir: join(dir, "missing"),
      dataBaseUrl: null,
      ttlMs: 60_000,
      fetchUpstream: async () => {
        calls++;
        return { cities: CITIES };
      },
    });
    await store.getEntry();
    const live = await store.getEntry({ live: true });
    expect(calls).toBe(2);
    expect(live.origin).toBe("upstream");
  });
});
