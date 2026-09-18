/** Typed API error with stable code (see docs/07-API-SPEC.md). */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthorized: () => new ApiError(401, "UNAUTHORIZED", "Authentication required"),
  forbidden: () => new ApiError(403, "FORBIDDEN", "Insufficient rights"),
  notFound: (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`),
  badRequest: (msg: string) => new ApiError(400, "BAD_REQUEST", msg),
  conflict: (msg: string) => new ApiError(409, "CONFLICT", msg),
  rateLimited: () => new ApiError(429, "RATE_LIMITED", "Too many requests"),
};
