import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env, isProd } from './config/env.js';
import { router } from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { morganStream } from './utils/logger.js';

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
  app.use(morgan(isProd ? 'combined' : 'dev', { stream: morganStream }));

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