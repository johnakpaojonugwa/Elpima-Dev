import { logger } from "../utils/logger.js";
import { isProd } from "../config/env.js";

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { message: `Route not found: ${req.method} ${req.originalUrl}` },
  });
}

// Express 5 auto-forwards rejected promises from async route handlers
// to this, so route handlers don't each need their own try/catch.
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  logger.error(err.message, { stack: err.stack, path: req.originalUrl });

  res.status(status).json({
    error: {
      message: status === 500 && isProd ? "Internal server error" : err.message,
      ...(isProd ? {} : { stack: err.stack }),
    },
  });
}
