import { Router } from "express";

import { prisma } from "../../config/prisma.js";
import {
  CreateLicenseSchema,
  ReviewLicenseSchema,
  LicenseIdParamSchema,
  ListLicensesQuerySchema,
} from "./validation.js";
import {
  createLicense,
  listLicenses,
  getLicenseById,
  reviewLicense,
} from "./service.js";
import { requireOrgType, requireRole } from "../../middlewares/auth.js";

// =====================================================================
// Licenses router — /api/v1/licenses (Phase 3)
// =====================================================================
//
// Mount site in src/routes/index.js applies `requireAuth`.
//
// Role & OrgType Gates:
//   - POST /: HOSPITAL only (requireOrgType("HOSPITAL")), submitted for own org
//   - GET /: Tenant-scoped for hospitals; global for PLATFORM_ADMIN
//   - GET /:id: Tenant-scoped for hospitals; global for PLATFORM_ADMIN
//   - PATCH /:id: PLATFORM_ADMIN only (approval / rejection review)

export const licensesRouter = Router();

/**
 * POST /api/v1/licenses
 *
 * Submits a new verification license for the authenticated hospital tenant.
 */
licensesRouter.post("/", requireOrgType("HOSPITAL"), async (req, res, next) => {
  try {
    const input = CreateLicenseSchema.parse(req.body);

    const license = await createLicense(
      prisma,
      req.user.organizationId,
      input,
      {
        id: req.user.id ?? null,
        supabaseUserId: req.user.supabaseUserId,
        role: req.user.role,
        organizationId: req.user.organizationId,
      },
    );

    res.status(201).json({
      success: true,
      data: { license },
      license, // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/licenses
 *
 * Lists licenses with tenant scoping.
 * Hospitals can only retrieve their own licenses.
 * Platform admins can browse all or filter by ?organizationId=
 */
licensesRouter.get("/", async (req, res, next) => {
  try {
    const query = ListLicensesQuerySchema.parse(req.query);

    const { items, nextCursor, limit } = await listLicenses(
      prisma,
      query,
      req.user,
    );

    res.status(200).json({
      success: true,
      data: { licenses: items },
      licenses: items, // backward-compatible alias
      meta: {
        pagination: {
          nextCursor,
          limit,
        },
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/licenses/:id
 *
 * Fetches a single license by ID.
 * Multi-tenant guard: returns 404 if accessed by an unauthorized tenant.
 */
licensesRouter.get("/:id", async (req, res, next) => {
  try {
    const { id } = LicenseIdParamSchema.parse(req.params);

    const license = await getLicenseById(prisma, id, req.user);

    res.status(200).json({
      success: true,
      data: { license },
      license, // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/licenses/:id
 *
 * Reviews a hospital license (approves or rejects).
 * Auth: PLATFORM_ADMIN only.
 */
licensesRouter.patch(
  "/:id",
  requireRole("PLATFORM_ADMIN"),
  async (req, res, next) => {
    try {
      const { id } = LicenseIdParamSchema.parse(req.params);
      const input = ReviewLicenseSchema.parse(req.body);

      const license = await reviewLicense(prisma, id, input, {
        id: req.user.id ?? null,
        supabaseUserId: req.user.supabaseUserId,
        role: req.user.role,
        organizationId: req.user.organizationId,
      });

      res.status(200).json({
        success: true,
        data: { license },
        license, // backward-compatible alias
        meta: {
          ...(req.correlationId ? { correlationId: req.correlationId } : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
