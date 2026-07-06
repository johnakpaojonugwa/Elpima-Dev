import { Router } from "express";
import { healthRouter } from "./health.route.js";

export const router = Router();

// Unversioned and outside /api on purpose — uptime monitors, load
// balancers, and container orchestrators expect a stable, predictable
// health path that won't shift when the API version bumps.
router.use("/health", healthRouter);

// Future business routes will mount here, versioned:
// router.use('/api/v1/organizations', organizationsRouter);
// router.use('/api/v1/products', productsRouter);
// router.use('/api/v1/quotes', quotesRouter);
