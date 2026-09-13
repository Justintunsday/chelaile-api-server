import { z } from "zod";
import { validationError } from "./errors.js";

export const coordinate = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a decimal number, e.g. '31.230416'");

export const cityId = z.string().min(1, "is required");

export const intString = z
  .string()
  .regex(/^\d+$/, "must be a positive integer string");

export const boolParam = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .default(defaultValue)
    .transform((v) => (typeof v === "boolean" ? v : v === "true" || v === "1"));

export function parseParams<T extends z.ZodTypeAny>(
  schema: T,
  raw: Record<string, string>,
): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export const citiesQuery = z.object({
  hot_only: boolParam(true),
  live: boolParam(false),
});

export const cityConfigQuery = z.object({
  city_id: cityId,
});

export const reverseGeoQuery = z.object({
  lat: coordinate,
  lng: coordinate,
});

export const myLocationQuery = z.object({
  ip: z.string().min(1).optional(),
});

export const searchQuery = z.object({
  city_id: cityId,
  keyword: z.string().min(1, "is required"),
});

export const searchMoreQuery = searchQuery.extend({
  type: z.enum(["1", "2", "3"]).default("1"),
});

export const nearbyQuery = z.object({
  city_id: cityId,
  lat: coordinate,
  lng: coordinate,
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const stopDetailQuery = z.object({
  city_id: cityId,
  physical_st_id: z.string().min(1, "is required"),
  namesake_st_id: z.string().min(1).optional(),
  first_line_id: z.string().min(1).optional(),
  lat: coordinate.optional(),
  lng: coordinate.optional(),
});

export const lineDetailQuery = z.object({
  city_id: cityId,
  line_id: z.string().min(1, "is required"),
  lat: coordinate.optional(),
  lng: coordinate.optional(),
});

export const lineRouteQuery = z.object({
  city_id: cityId,
  line_id: z.string().min(1, "is required"),
  include_shape: boolParam(false),
});

export const lineRealtimeQuery = z.object({
  city_id: cityId,
  line_id: z.string().min(1, "is required"),
  target_order: intString,
  station_id: z.string().min(1, "is required"),
  lat: coordinate,
  lng: coordinate,
});

export const lineBusesQuery = z.object({
  city_id: cityId,
  line_id: z.string().min(1, "is required"),
  target_order: intString,
  station_name: z.string().min(1, "is required"),
});

export const timetableQuery = z.object({
  city_id: cityId,
  line_id: z.string().min(1, "is required"),
  line_no: z.string().min(1, "is required"),
  direction: z.enum(["0", "1"]),
});

export const refreshQuery = z.object({
  city_id: cityId,
  line_stn: z.string().min(1, "is required"),
});

export const transitQuery = z.object({
  city_id: cityId,
  origin_name: z.string().min(1, "is required"),
  origin_lat: coordinate,
  origin_lng: coordinate,
  dest_name: z.string().min(1, "is required"),
  dest_lat: coordinate,
  dest_lng: coordinate,
  strategy: z.enum(["0", "1", "2", "3"]).default("0"),
});
