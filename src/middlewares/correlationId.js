import { randomUUID } from "node:crypto";

/**
 * Mint a per-request correlation ID and surface it on both the
 * request and the response. The ID is what the access log line, the
 * error log line, and the client-side error response all share — so
 * an end-to-end trace of a single request can be assembled from any
 * of those three views.
 *
 * If the client sends X-Request-Id we honor it, subject to a strict
 * allow-list (see below). Otherwise we mint a fresh UUID. Either way
 * the value is set on `req.correlationId` and echoed back in the
 * `X-Request-Id` response header.
 *
 * Why accept X-Request-Id from the client: a frontend or upstream
 * proxy may want to thread its own trace ID through the API. The
 * strict allow-list is the guard against log-injection attacks
 * (CR/LF in the value would otherwise let a client forge fake log
 * entries).
 */
export function correlationId(request, response, next) {
  const incoming = request.headers["x-request-id"];
  const value =
    typeof incoming === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(incoming)
      ? incoming
      : randomUUID();

  request.correlationId = value;
  // Set the response header now, before any handler runs, so even a
  // short-circuited response (synchronous throw, 401, 404, 500) still
  // carries the ID.
  response.setHeader("X-Request-Id", value);

  next();
}
