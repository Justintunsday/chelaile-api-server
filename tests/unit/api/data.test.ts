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
  test("oversized remote datasets are cancelled before falling back to upstream", async () => {
    let cancelled = false;
    const store = new CityStore({ dataDir: "missing", dataBaseUrl: "https://cdn.example", ttlMs: 1000,
      fetchImpl: (async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(17 * 1024 * 1024));
          setTimeout(() => { try { controller.close(); } catch {} }, 50);
        },
        cancel() { cancelled = true; },
      }))) as typeof fetch,
      fetchUpstream: async () => ({ cities: CITIES }),
    });
    expect((await store.getEntry()).origin).toBe("upstream");
    expect(cancelled).toBe(true);
  });
  test("concurrent cache misses share one remote load and preserve city IDs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const store = new CityStore({
      dataDir: "missing", dataBaseUrl: "https://cdn.example", ttlMs: 60_000,
      fetchImpl: (async () => { calls++; await gate; return Response.json(DATASET); }) as typeof fetch,
    });
    const requests = Array.from({ length: 20 }, () => store.servedCities(false));
    release();
    const results = await Promise.all(requests);
    expect(calls).toBe(1);
    expect(results.every((result) => result.cities[0].cityId === "034")).toBe(true);
  });

  test("a failed shared load is cleared so a subsequent request can recover", async () => {
    let calls = 0;
    const store = new CityStore({
      dataDir: "missing", dataBaseUrl: null, ttlMs: 60_000,
      fetchUpstream: async () => { if (++calls === 1) throw new Error("temporary failure"); return { cities: CITIES }; },
    });
    const initial = await Promise.allSettled([store.getEntry(), store.getEntry()]);
    expect(initial.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect((await store.getEntry()).dataset.cities).toEqual(CITIES);
    expect(calls).toBe(2);
  });

  test("live results do not replace the static cache and disabled TTL continues reloading", async () => {
    let calls = 0;
    const store = new CityStore({ dataDir: "missing", dataBaseUrl: null, ttlMs: 60_000,
      fetchUpstream: async () => ({ cities: [{ ...CITIES[0], cityName: `load-${++calls}` }] }),
    });
    expect((await store.getEntry()).dataset.cities[0].cityName).toBe("load-1");
    expect((await store.getEntry({ live: true })).dataset.cities[0].cityName).toBe("load-2");
    expect((await store.getEntry()).dataset.cities[0].cityName).toBe("load-1");
    const uncached = new CityStore({ dataDir: "missing", dataBaseUrl: null, ttlMs: 0,
      fetchUpstream: async () => ({ cities: [{ ...CITIES[0], cityName: `load-${++calls}` }] }),
    });
    expect(Object.keys(await uncached.getEntry()).sort()).toEqual(["dataset", "origin"]);
    await uncached.getEntry();
    expect(calls).toBe(4);
  });
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
