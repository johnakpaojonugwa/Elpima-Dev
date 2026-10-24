/**
 * Standardized API response formatters.
 * Conforms to Core API & Security Practices:
 * Success: { success: true, data: ..., meta: ... }
 * Error:   { success: false, error: ... }
 */

/**
 * Send a standardized success JSON response.
 *
 * @param {import("express").Response} response
 * @param {number} statusCode
 * @param {any} data
 * @param {object} [meta]
 */
export function successResponse(response, statusCode, data, meta = {}) {
  const correlationId = response.req?.correlationId;

  return response.status(statusCode).json({
    success: true,
    data,
    meta: {
      ...(correlationId ? { correlationId } : {}),
      ...meta,
    },
  });
}
