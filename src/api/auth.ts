import { createHash, timingSafeEqual } from "node:crypto";

// Compare fixed-size hashes so different UTF-8 byte lengths cannot throw or
// reveal the configured key length through an early length check.
export function matchesApiKey(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
