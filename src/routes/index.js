import { Router } from "express";
import { healthRouter } from "./health.route.js";
import { authRouter } from "./auth.route.js";

export const router = Router();

// Unversioned and outside /api on purpose — uptime monitors, load
// balancers, and container orchestrators expect a stable, predictable
// health path that won't shift when the API version bumps.
router.use("/health", healthRouter);

// Auth plumbing (login, /me, future refresh). Unversioned on purpose:
// the auth surface is small and stable, and the frontend needs the
// same path in v1, v2, etc.
router.use("/auth", authRouter);

// Future business routes will mount here, versioned:
// router.use('/api/v1/organizations', organizationsRouter);
// router.use('/api/v1/products', productsRouter);
// router.use('/api/v1/quotes', quotesRouter);
