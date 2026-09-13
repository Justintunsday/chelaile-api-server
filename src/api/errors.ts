import { z } from "zod";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    hint?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { hint?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export function validationError(error: z.ZodError): ApiError {
  return new ApiError(
    400,
    "invalid_params",
    "One or more request parameters are invalid.",
    {
      details: error.issues.map((issue) => ({
        param: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    },
  );
}

export function notFound(pathname: string): ApiError {
  return new ApiError(
    404,
    "not_found",
    `No API route matches ${pathname}.`,
    { hint: "See GET / for the endpoint index, or docs/API.md for the full reference." },
  );
}

export function methodNotAllowed(method: string, pathname: string): ApiError {
  return new ApiError(
    405,
    "method_not_allowed",
    `${method} is not supported for ${pathname}.`,
    { hint: "All chelaile API endpoints are read-only and use GET." },
  );
}

export function unauthorized(): ApiError {
  return new ApiError(401, "unauthorized", "Missing or invalid API key.", {
    hint: "Pass the key via the X-API-Key header or the ?key= query parameter.",
  });
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(429, "rate_limited", "Too many requests.", {
    hint: `Retry after ${retryAfterSeconds}s or raise RATE_LIMIT_PER_MINUTE.`,
  });
}

// Maps arbitrary upstream/runtime failures onto HTTP semantics: timeouts become
// 504, everything else that bubbled up from the upstream API becomes 502.
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(message)) {
    return new ApiError(504, "upstream_timeout", message, {
      hint: "The upstream chelaile service is slow; retry the request.",
    });
  }
  if (/aborted|AbortError/i.test(message)) {
    return new ApiError(504, "upstream_timeout", "Upstream request aborted.");
  }
  return new ApiError(502, "upstream_error", message, {
    hint: "The upstream chelaile service returned an error or an unexpected payload.",
  });
}
