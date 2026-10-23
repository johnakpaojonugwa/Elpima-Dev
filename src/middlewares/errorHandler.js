import { ZodError } from "zod";

import { logger } from "../utils/logger.js";
import { isProd } from "../config/env.js";

/**
 * Map an unknown thrown value to a safe response shape.
 *
 * The rule of thumb: the CLIENT only ever sees what the client is
 * allowed to see. Internal error detail (Prisma's failing SQL, a JWT
 * library's reason string, an upstream service's response body) goes
 * to the log aggregator where engineers can debug it — never to the
 * wire.
 *
 * Status semantics:
 *   - 4xx = the client did something wrong. They need a real message
 *     so they can fix their request (validation fields, auth state).
 *   - 5xx = we did something wrong or a dependency did. They get a
 *     generic message + a correlationId; we keep the detail.
 */
function classifyError(err) {
  // 1. Errors explicitly raised with a status by route handlers
  //    (AppError, HttpError, or any err with .status / .statusCode).
  //    The route owns the message because the route knows the context.
  const explicitStatus = err?.status ?? err?.statusCode;
  if (explicitStatus && explicitStatus >= 400 && explicitStatus < 500) {
    return {
      kind: "client_error",
      status: explicitStatus,
      clientMessage: err.message || "Request failed",
      logMessage: err.message,
    };
  }

  // 2. Zod validation — the client sent bad input. The aggregated
  //    field errors are safe to echo back (they're the client's own
  //    data names, not server internals) and the client genuinely
  //    needs them to fix the request.
  if (err instanceof ZodError) {
    return {
      kind: "validation_error",
      status: 400,
      clientMessage: "Invalid request payload",
      logMessage: "Zod validation failed",
      details: { fieldErrors: err.flatten().fieldErrors },
    };
  }

  // 3. JWT errors — name-based detection avoids importing jsonwebtoken
  //    just for instanceof. The library has used these names for years.
  if (err?.name === "TokenExpiredError") {
    return {
      kind: "auth_error",
      status: 401,
      clientMessage: "Session expired",
      logMessage: "JWT expired",
    };
  }
  if (err?.name === "JsonWebTokenError" || err?.name === "NotBeforeError") {
    return {
      kind: "auth_error",
      status: 401,
      clientMessage: "Authentication required",
      logMessage: `JWT rejected: ${err.message}`,
    };
  }

  // 4. Prisma errors. PrismaClientKnownRequestError covers the
  //    P-codes (unique constraint, FK violation, record not found,
  //    etc.) — these are the leaky ones, because err.message embeds
  //    the failing SQL and the constraint/column names. We treat
  //    ALL of them as 500 from the client's perspective and keep
  //    the detail in the log.
  if (err?.name === "PrismaClientKnownRequestError") {
    return {
      kind: "database_error",
      status: 500,
      clientMessage: "A database error occurred",
      logMessage: `Prisma ${err.code ?? "unknown"}: ${err.message}`,
    };
  }
  if (
    err?.name === "PrismaClientUnknownRequestError" ||
    err?.name === "PrismaClientInitializationError" ||
    err?.name === "PrismaClientRustPanicError"
  ) {
    return {
      kind: "database_error",
      status: 500,
      clientMessage: "A database error occurred",
      logMessage: `Prisma ${err.name}: ${err.message}`,
    };
  }

  // 5. ValidationError from Prisma's internal validator — also leaks
  //    argument names but the client gave us a bad value, so 400.
  if (err?.name === "PrismaClientValidationError") {
    return {
      kind: "validation_error",
      status: 400,
      clientMessage: "Invalid request payload",
      logMessage: `Prisma validation: ${err.message}`,
    };
  }

  // 6. Anything else is a true 500. Don't echo err.message to the
  //    client — we don't know what it contains, and "a Node TypeError
  //    from a dep upgrade" leaking table names is exactly the failure
  //    mode we're guarding against.
  return {
    kind: "internal_error",
    status: explicitStatus && explicitStatus >= 500 ? explicitStatus : 500,
    clientMessage: "Internal server error",
    logMessage: err?.message || String(err),
  };
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      correlationId: req.correlationId,
    },
  });
}

// Express 5 auto-forwards rejected promises from async route handlers
// to this, so route handlers don't each need their own try/catch.
export function errorHandler(err, req, res, _next) {
  // The correlationId middleware mints req.correlationId on every
  // request before anything else runs, so the error log line and
  // the access log line for the same request share the same ID.
  // The fallback handles a misuse (errorHandler mounted before
  // correlationId) without crashing.
  const correlationId = req.correlationId ?? "no-correlation-id";

  const classified = classifyError(err);

  // Internal log: full detail, including stack, so engineers can
  // debug in the aggregator. The err.message is logged via the
  // `logMessage` slot (which may include a prefix like "Prisma P2002:"
  // for searchability) but never in a way that gets echoed back.
  logger.error(classified.logMessage, {
    kind: classified.kind,
    status: classified.status,
    correlationId,
    method: req.method,
    path: req.originalUrl,
    stack: err?.stack,
    // Only attach the validation field summary if this was a Zod/
    // Prisma validation error. Other kinds don't have it.
    ...(classified.details ? { details: classified.details } : {}),
  });

  // Client response: sanitized responsive envelope. In dev, attach a `devMessage` with
  // the real message behind the same NODE_ENV gate we already use
  // for stacks, so local debugging still works without ever shipping
  // internals to prod.
  const body = {
    success: false,
    error: {
      message: classified.clientMessage,
      correlationId,
      kind: classified.kind,
      ...(classified.details ? { details: classified.details } : {}),
    },
  };
  if (!isProd) {
    body.error.devMessage = err?.message;
    body.error.stack = err?.stack;
  }

  res.status(classified.status).json(body);
}
