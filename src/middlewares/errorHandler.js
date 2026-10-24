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
function classifyError(error) {
  // 1. Errors explicitly raised with a status by route handlers
  //    (AppError, HttpError, or any error with .status / .statusCode).
  //    The route owns the message because the route knows the context.
  const explicitStatus = error?.status ?? error?.statusCode;
  if (explicitStatus && explicitStatus >= 400 && explicitStatus < 500) {
    return {
      kind: "client_error",
      status: explicitStatus,
      clientMessage: error.message || "Request failed",
      logMessage: error.message,
    };
  }

  // 2. Zod validation — the client sent bad input. The aggregated
  //    field errors are safe to echo back (they're the client's own
  //    data names, not server internals) and the client genuinely
  //    needs them to fix the request.
  if (error instanceof ZodError) {
    return {
      kind: "validation_error",
      status: 400,
      clientMessage: "Invalid request payload",
      logMessage: "Zod validation failed",
      details: { fieldErrors: error.flatten().fieldErrors },
    };
  }

  // 3. JWT errors — name-based detection avoids importing jsonwebtoken
  //    just for instanceof. The library has used these names for years.
  if (error?.name === "TokenExpiredError") {
    return {
      kind: "auth_error",
      status: 401,
      clientMessage: "Session expired",
      logMessage: "JWT expired",
    };
  }
  if (error?.name === "JsonWebTokenError" || error?.name === "NotBeforeError") {
    return {
      kind: "auth_error",
      status: 401,
      clientMessage: "Authentication required",
      logMessage: `JWT rejected: ${error.message}`,
    };
  }

  // 4. Prisma errors. PrismaClientKnownRequestError covers the
  //    P-codes (unique constraint, FK violation, record not found,
  //    etc.) — these are the leaky ones, because error.message embeds
  //    the failing SQL and the constraint/column names. We treat
  //    ALL of them as 500 from the client's perspective and keep
  //    the detail in the log.
  if (error?.name === "PrismaClientKnownRequestError") {
    return {
      kind: "database_error",
      status: 500,
      clientMessage: "A database error occurred",
      logMessage: `Prisma ${error.code ?? "unknown"}: ${error.message}`,
    };
  }
  if (
    error?.name === "PrismaClientUnknownRequestError" ||
    error?.name === "PrismaClientInitializationError" ||
    error?.name === "PrismaClientRustPanicError"
  ) {
    return {
      kind: "database_error",
      status: 500,
      clientMessage: "A database error occurred",
      logMessage: `Prisma ${error.name}: ${error.message}`,
    };
  }

  // 5. ValidationError from Prisma's internal validator — also leaks
  //    argument names but the client gave us a bad value, so 400.
  if (error?.name === "PrismaClientValidationError") {
    return {
      kind: "validation_error",
      status: 400,
      clientMessage: "Invalid request payload",
      logMessage: `Prisma validation: ${error.message}`,
    };
  }

  // 6. Anything else is a true 500. Don't echo error.message to the
  //    client — we don't know what it contains, and "a Node TypeError
  //    from a dep upgrade" leaking table names is exactly the failure
  //    mode we're guarding against.
  return {
    kind: "internal_error",
    status: explicitStatus && explicitStatus >= 500 ? explicitStatus : 500,
    clientMessage: "Internal server error",
    logMessage: error?.message || String(error),
  };
}

export function notFoundHandler(request, response) {
  response.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${request.method} ${request.originalUrl}`,
      correlationId: request.correlationId,
    },
  });
}

// Express 5 auto-forwards rejected promises from async route handlers
// to this, so route handlers don't each need their own try/catch.
export function errorHandler(error, request, response, _next) {
  // The correlationId middleware mints request.correlationId on every
  // request before anything else runs, so the error log line and
  // the access log line for the same request share the same ID.
  // The fallback handles a misuse (errorHandler mounted before
  // correlationId) without crashing.
  const correlationId = request.correlationId ?? "no-correlation-id";

  const classified = classifyError(error);

  // Internal log: full detail, including stack, so engineers can
  // debug in the aggregator. The error.message is logged via the
  // `logMessage` slot (which may include a prefix like "Prisma P2002:"
  // for searchability) but never in a way that gets echoed back.
  logger.error(classified.logMessage, {
    kind: classified.kind,
    status: classified.status,
    correlationId,
    method: request.method,
    path: request.originalUrl,
    stack: error?.stack,
    // Only attach the validation field summary if this was a Zod/
    // Prisma validation error. Other kinds don't have it.
    ...(classified.details ? { details: classified.details } : {}),
  });

  // Client response: sanitized responsive envelope. In dev, attach a `devMessage` with
  // the real message behind the same NODE_ENV gate we already use
  // for stacks, so local debugging still works without ever shipping
  // internals to prod.
  const responseBody = {
    success: false,
    error: {
      message: classified.clientMessage,
      correlationId,
      kind: classified.kind,
      ...(classified.details ? { details: classified.details } : {}),
    },
  };
  if (!isProd) {
    responseBody.error.devMessage = error?.message;
    responseBody.error.stack = error?.stack;
  }

  response.status(classified.status).json(responseBody);
}
