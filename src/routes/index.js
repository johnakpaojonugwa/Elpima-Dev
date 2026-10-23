import { Router } from "express";
import { healthRouter } from "./health.route.js";
import { authRouter } from "./auth.route.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { organizationsRouter } from "../modules/organizations/route.js";

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
// Organizations: PLATFORM_ADMIN-only. The role gate lives at the
// mount site, not inside the module, so every route in the module
// inherits it without each handler re-checking. (Per-route gates
// like `requireOrgType` are still composed per-handler when the
// module's surface mixes roles.)
router.use(
  "/api/v1/organizations",
  requireAuth,
  requireRole("PLATFORM_ADMIN"),
  organizationsRouter,
);
