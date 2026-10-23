import { Router } from "express";

import { prisma, directPrisma } from "../../config/prisma.js";
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
  OrganizationIdParamSchema,
} from "./validation.js";
import {
  createOrganization,
  getOrganizationById,
  updateOrganization,
} from "./service.js";
import { requireRole } from "../../middlewares/auth.js";
import { AppError } from "../../utils/AppError.js";

// =====================================================================
// Organizations route — HTTP wiring for /api/v1/organizations
// =====================================================================
//
// This router is mounted under `/api/v1/organizations` from
// src/routes/index.js.
//
// Role gates:
//   - POST /: PLATFORM_ADMIN only (registers a new tenant)
//   - GET /:id: Caller can read own org (scoped by req.user.organizationId);
//               PLATFORM_ADMIN can read any org. Cross-tenant reads return 404.
//   - PATCH /:id: ORG_ADMIN can update own org; PLATFORM_ADMIN can update any org.
//                 Cross-tenant updates return 404.

export const organizationsRouter = Router();

/**
 * POST /api/v1/organizations
 *
 * Body: CreateOrganizationSchema
 * Auth: PLATFORM_ADMIN only
 */
organizationsRouter.post("/", requireRole("PLATFORM_ADMIN"), async (req, res, next) => {
  try {
    const input = CreateOrganizationSchema.parse(req.body);

    const { organization, user } = await createOrganization(
      // Uses unpooled directPrisma client to guarantee atomic rollback
      // on interactive $transaction without PgBouncer transaction-mode timeouts.
      directPrisma,
      input,
      {
        role: req.user?.role ?? "PLATFORM_ADMIN",
        id: null,
        organizationId: req.user?.organizationId ?? null,
      },
    );

    res.status(201).json({
      success: true,
      data: { organization, user },
      organization, // backward-compatible alias
      user,         // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/organizations/:id
 *
 * Reads an organization by ID.
 * Multi-tenant guard: Non-platform admins can ONLY access their own organization.
 * Cross-tenant accesses fail with 404 to avoid ID enumeration.
 */
organizationsRouter.get("/:id", async (req, res, next) => {
  try {
    const { id } = OrganizationIdParamSchema.parse(req.params);

    // Multi-tenant boundary: verify caller has authority to read this tenant
    const isPlatformAdmin = req.user?.role === "PLATFORM_ADMIN";
    const isOwnOrg = req.user?.organizationId === id;

    if (!isPlatformAdmin && !isOwnOrg) {
      throw new AppError(404, "Organization not found");
    }

    const organization = await getOrganizationById(prisma, id, {
      role: req.user?.role ?? "ORG_STAFF",
      id: null,
      organizationId: req.user?.organizationId ?? null,
    });

    res.status(200).json({
      success: true,
      data: { organization },
      organization, // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/organizations/:id
 *
 * Updates an organization profile.
 * Auth: ORG_ADMIN or PLATFORM_ADMIN.
 * Multi-tenant guard: ORG_ADMIN can only update their own organization.
 */
organizationsRouter.patch(
  "/:id",
  requireRole("ORG_ADMIN", "PLATFORM_ADMIN"),
  async (req, res, next) => {
    try {
      const { id } = OrganizationIdParamSchema.parse(req.params);

      const isPlatformAdmin = req.user?.role === "PLATFORM_ADMIN";
      const isOwnOrg = req.user?.organizationId === id;

      if (!isPlatformAdmin && !isOwnOrg) {
        throw new AppError(404, "Organization not found");
      }

      const input = UpdateOrganizationSchema.parse(req.body);

      const organization = await updateOrganization(prisma, id, input, {
        role: req.user?.role ?? "ORG_ADMIN",
        id: null,
        organizationId: req.user?.organizationId ?? null,
      });

      res.status(200).json({
        success: true,
        data: { organization },
        organization, // backward-compatible alias
        meta: {
          ...(req.correlationId ? { correlationId: req.correlationId } : {}),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

