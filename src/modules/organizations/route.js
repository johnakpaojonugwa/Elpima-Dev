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
 * @openapi
 * /api/v1/organizations:
 *   post:
 *     summary: Register a new organization and root admin user
 *     description: Atomically provisions an organization and its initial administrator. Accessible only to PLATFORM_ADMIN.
 *     tags:
 *       - Organizations
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type, email, password]
 *             properties:
 *               name: { type: string, example: "St. Jude Hospital" }
 *               type: { type: string, enum: ["HOSPITAL", "VENDOR"], example: "HOSPITAL" }
 *               email: { type: string, format: email, example: "admin@stjude.org" }
 *               password: { type: string, minLength: 8, example: "SecurePass123!" }
 *               phone: { type: string, example: "+2348012345678" }
 *               address: { type: string, example: "Plot 12, Medical District, Abuja" }
 *     responses:
 *       201:
 *         description: Organization and admin user created
 *       400:
 *         description: Validation error or duplicate email
 *       403:
 *         description: Forbidden (insufficient permissions)
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
 * @openapi
 * /api/v1/organizations/{id}:
 *   get:
 *     summary: Retrieve an organization by ID
 *     description: Reads organization details. Scoped to caller's own tenant; PLATFORM_ADMIN can access any. Cross-tenant access returns 404.
 *     tags:
 *       - Organizations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Organization profile retrieved
 *       404:
 *         description: Organization not found or cross-tenant access denied
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
 * @openapi
 * /api/v1/organizations/{id}:
 *   patch:
 *     summary: Update an organization
 *     description: Modifies organization details. Scoped to ORG_ADMIN for own organization or PLATFORM_ADMIN for any.
 *     tags:
 *       - Organizations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               address: { type: string }
 *               status: { type: string, enum: ["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"] }
 *     responses:
 *       200:
 *         description: Organization updated successfully
 *       404:
 *         description: Organization not found or cross-tenant access denied
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

