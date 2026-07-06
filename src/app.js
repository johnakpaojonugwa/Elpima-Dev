import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env, isProd } from './config/env.js';
import { router } from './routes/index.js';
import { notFoundHandler, errorHandler } from './middlewares/errorHandler.js';
import { morganStream } from './utils/logger.js';
import { correlationId } from './middlewares/correlationId.js';

// Custom morgan format: returns a JSON-encoded line so the stream
// (morganStream.write in utils/logger.js) can pull structured fields
// off it and forward them to winston. The fields are the only
// things logged — request body, query, and headers are deliberately
// omitted to avoid leaking PHI/PII.
function jsonAccessLog(tokens, req, res) {
  const userId = req.user?.supabaseUserId;
  const organizationId = req.user?.organizationId;
  return JSON.stringify({
    msg: "http_request",
    correlationId: req.correlationId,
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    status: Number(tokens.status(req, res)),
    durationMs: Number(tokens["response-time"](req, res)),
    userId,
    organizationId,
    ip: tokens["remote-addr"](req, res),
  });
}

// Exported as a factory (not a started server) so tests can import
// and hit it directly with supertest, no open port required.
export function createApp() {
  const app = express();

  // Trust the first proxy hop (Render/Railway/Fly/etc. all sit behind one),
  // needed for rate-limit and req.ip to see the real client IP.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(hpp());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Mounted before morgan so the access log line carries the
  // correlation ID. Mounted before everything that can short-circuit
  // a response (rate limit, route handlers, errorHandler) so even a
  // 401/404/500 response has an X-Request-Id header.
  app.use(correlationId);

  // JSON access log. The format function reads req.correlationId and
  // req.user; both are set before morgan runs (correlation ID by the
  // middleware above, req.user by requireAuth inside a route).
  app.use(morgan(jsonAccessLog, { stream: morganStream }));

  // Global rate limit as a baseline. Tighter, route-specific limits
  // (e.g. on auth endpoints) can layer on top later.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use(router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
