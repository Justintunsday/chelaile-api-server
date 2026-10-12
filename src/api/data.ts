import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readResponseText } from "../upstream-http.js";
import { fetchCityList, type LeanCity } from "../tools/city.js";

import { filterCities, parseCityDataset, type CityDataset, type CityOrigin, type ServedCities } from "./city-dataset.js";
export { filterCities, parseCityDataset, type CityDataset, type CityOrigin, type ServedCities } from "./city-dataset.js";

export interface CityStoreOptions {
  dataDir: string;
  dataBaseUrl: string | null;
  ttlMs: number;
  fetchImpl?: typeof fetch;
  fetchUpstream?: (
    hotOnly: boolean,
  ) => Promise<{ cities: LeanCity[] } | LeanCity[]>;
  remoteTimeoutMs?: number;
}

interface CacheEntry {
  dataset: CityDataset;
  origin: CityOrigin;
  fetchedAt: number;
}

export class CityStore {
  private readonly options: Required<
    Pick<
      CityStoreOptions,
      "dataDir" | "dataBaseUrl" | "ttlMs" | "fetchImpl" | "fetchUpstream" | "remoteTimeoutMs"
    >
  >;
  private cache: CacheEntry | null = null;
  private pending: Promise<CacheEntry> | null = null;

  constructor(options: CityStoreOptions) {
    this.options = {
      dataDir: options.dataDir,
      dataBaseUrl: options.dataBaseUrl,
      ttlMs: options.ttlMs,
      fetchImpl: options.fetchImpl ?? fetch,
      fetchUpstream: options.fetchUpstream ?? fetchCityList,
      remoteTimeoutMs: options.remoteTimeoutMs ?? 8000,
    };
  }

  private async fromUpstream(): Promise<CacheEntry> {
    const result = await this.options.fetchUpstream(false);
    const cities = Array.isArray(result) ? result : result.cities;
    return {
      dataset: {
        updatedAt: new Date().toISOString(),
        source: "chelaile:/wwd/ncitylist",
        cities,
      },
      origin: "upstream",
      fetchedAt: Date.now(),
    };
  }

  private async fromRemote(): Promise<CacheEntry | null> {
    if (!this.options.dataBaseUrl) return null;
    const url = `${this.options.dataBaseUrl}/cities.json`;
    try {
      const res = await this.options.fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.options.remoteTimeoutMs),
      });
      const dataset = parseCityDataset(JSON.parse(await readResponseText(res)));
      if (!dataset) return null;
      return { dataset, origin: "github", fetchedAt: Date.now() };
    } catch {
      return null;
    }
  }

  private async fromFile(): Promise<CacheEntry | null> {
    try {
      const raw = await readFile(
        join(this.options.dataDir, "cities.json"),
        "utf-8",
      );
      const dataset = parseCityDataset(JSON.parse(raw));
      if (!dataset) return null;
      return { dataset, origin: "file", fetchedAt: Date.now() };
    } catch {
      return null;
    }
  }

  async getEntry(
    options: { live?: boolean } = {},
  ): Promise<{ dataset: CityDataset; origin: CityOrigin }> {
    if (options.live) {
      const entry = await this.fromUpstream();
      return { dataset: entry.dataset, origin: entry.origin };
    }

    const now = Date.now();
    if (
      this.cache &&
      this.options.ttlMs > 0 &&
      now - this.cache.fetchedAt < this.options.ttlMs
    ) {
      return { dataset: this.cache.dataset, origin: this.cache.origin };
    }

    // Only cacheable Node loads share I/O. live=true and disabled TTL retain
    // their original fresh-load behavior.
    if (this.options.ttlMs <= 0) return this.loadEntry();
    if (!this.pending) this.pending = this.loadEntry();
    const pending = this.pending;
    let entry: CacheEntry;
    try { entry = await pending; }
    finally { if (this.pending === pending) this.pending = null; }
    return { dataset: entry.dataset, origin: entry.origin };
  }

  private async loadEntry(): Promise<CacheEntry> {
    const entry = (await this.fromRemote()) ?? (await this.fromFile()) ?? (await this.fromUpstream());
    this.cache = entry;
    return entry;
  }

  async servedCities(
    hotOnly: boolean,
    live = false,
  ): Promise<ServedCities> {
    const { dataset, origin } = await this.getEntry({ live });
    const cities = filterCities(dataset.cities, hotOnly);
    return {
      origin,
      updatedAt: dataset.updatedAt,
      hotOnly,
      count: cities.length,
      total: dataset.cities.length,
      cities,
    };
  }
}
