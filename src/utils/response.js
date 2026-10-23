/**
 * Standardized API response formatters.
 * Conforms to Core API & Security Practices:
 * Success: { success: true, data: ..., meta: ... }
 * Error:   { success: false, error: ... }
 */

/**
 * Send a standardized success JSON response.
 *
 * @param {import("express").Response} res
 * @param {number} statusCode
 * @param {any} data
 * @param {object} [meta]
 */
export function successResponse(res, statusCode, data, meta = {}) {
  const correlationId = res.req?.correlationId;

  return res.status(statusCode).json({
    success: true,
    data,
    meta: {
      ...(correlationId ? { correlationId } : {}),
      ...meta,
    },
  });
}
