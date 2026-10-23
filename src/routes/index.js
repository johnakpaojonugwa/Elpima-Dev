import { Router } from "express";
import { healthRouter } from "./health.route.js";
import { authRouter } from "./auth.route.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { organizationsRouter } from "../modules/organizations/route.js";
import { productsRouter } from "../modules/products/route.js";

export const router = Router();

// Unversioned and outside /api on purpose — uptime monitors, load
// balancers, and container orchestrators expect a stable, predictable
// health path that won't shift when the API version bumps.
// Mounted under both /health and /healthz for standard cloud convention.
router.use("/health", healthRouter);
router.use("/healthz", healthRouter);

// Auth plumbing (login, /me, future refresh). Unversioned on purpose:
// the auth surface is small and stable, and the frontend needs the
// same path in v1, v2, etc.
router.use("/auth", authRouter);

// Business routes, versioned. Each module owns its full surface
// (route + service + validation); the mount site is the only place
// that knows about the global middleware chain (auth + role gate).
//
// Organizations: All routes require authentication. Role-based gates
// (POST requires PLATFORM_ADMIN, PATCH requires ORG_ADMIN or PLATFORM_ADMIN,
// GET requires tenant scope or PLATFORM_ADMIN) are enforced per route inside the module.
router.use(
  "/api/v1/organizations",
  requireAuth,
  organizationsRouter,
);

// Products: Catalog management and browsing. All routes require authentication.
// Write access (POST, PATCH, DELETE) requires VENDOR role; read access (GET)
// is available to both hospitals and vendors for catalog browsing.
router.use(
  "/api/v1/products",
  requireAuth,
  productsRouter,
);
