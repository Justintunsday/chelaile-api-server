// Fetches the chelaile static datasets and writes them to data/.
// Runs from GitHub Actions (see .github/workflows/sync-data.yml) on a daily
// schedule, and locally via `npm run sync-data` / `bun scripts/sync-data.ts`.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCityList } from "../src/tools/city.js";
import { parseCityDataset } from "../src/api/data.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const MIN_CITIES = 50;
const MAX_SHRINK_RATIO = 0.4;
const FETCH_ATTEMPTS = 3;

const args = process.argv.slice(2);
const force =
  args.includes("--force") || process.env.SYNC_DATA_FORCE === "true";
const targetArg = args.find((a) => !a.startsWith("-"));
const target = resolve(root, targetArg ?? process.env.SYNC_DATA_OUTPUT ?? "data/cities.json");

function log(message: string): void {
  console.log(`[sync-data] ${message}`);
}

async function setOutput(name: string, value: string | number): Promise<void> {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  await appendFile(outputFile, `${name}=${value}\n`);
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = FETCH_ATTEMPTS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      log(`${label} failed (attempt ${attempt}/${attempts}): ${message}`);
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }
  throw lastError;
}

async function previousCount(): Promise<number> {
  try {
    const raw = await readFile(target, "utf-8");
    return parseCityDataset(JSON.parse(raw))?.cities.length ?? 0;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  log(`Fetching city list from web.chelaile.net.cn ...`);
  const { cities } = await withRetry("fetchCityList", () =>
    fetchCityList(false),
  );
  log(`Upstream returned ${cities.length} cities.`);

  if (cities.length < MIN_CITIES) {
    throw new Error(
      `Refusing to overwrite the dataset: only ${cities.length} cities returned (< ${MIN_CITIES}).`,
    );
  }

  const previous = await previousCount();
  if (
    !force &&
    previous > 0 &&
    cities.length < previous * (1 - MAX_SHRINK_RATIO)
  ) {
    throw new Error(
      `Refusing to overwrite the dataset: city count dropped from ${previous} to ${cities.length} ` +
        `(more than ${Math.round(MAX_SHRINK_RATIO * 100)}%). ` +
        `Re-run with --force (or SYNC_DATA_FORCE=true) to accept.`,
    );
  }

  const hotCount = cities.filter((c) => c.hot).length;
  const dataset = {
    updatedAt: new Date().toISOString(),
    source: "chelaile:/wwd/ncitylist",
    count: cities.length,
    cities,
  };

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(dataset, null, 2)}\n`, "utf-8");
  log(
    `Wrote ${target} (${cities.length} cities, ${hotCount} hot; previous ${previous}).`,
  );

  await setOutput("count", cities.length);
  await setOutput("hot_count", hotCount);
  await setOutput("previous_count", previous);
}

main().catch((error) => {
  console.error("[sync-data] Sync failed:", error);
  process.exit(1);
});
