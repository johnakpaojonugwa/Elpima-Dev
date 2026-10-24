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
 * @openapi
 * /api/v1/licenses:
 *   post:
 *     summary: Submit a hospital verification license
 *     description: Submits a new verification license document and metadata. Restricted to HOSPITAL organizations.
 *     tags:
 *       - Licenses
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [licenseNumber, issuingBody, documentUrl, expiresAt]
 *             properties:
 *               licenseNumber: { type: string, example: "MDCN/2026/89412" }
 *               issuingBody: { type: string, example: "Medical and Dental Council of Nigeria" }
 *               documentUrl: { type: string, format: uri, example: "https://storage.elpima.com/licenses/hosp1/cert.pdf" }
 *               expiresAt: { type: string, format: date-time, example: "2028-12-31T23:59:59.000Z" }
 *     responses:
 *       201:
 *         description: License submitted for review
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden (Vendors cannot submit hospital licenses)
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
 * @openapi
 * /api/v1/licenses:
 *   get:
 *     summary: List hospital verification licenses
 *     description: Retrieves licenses. Hospitals see only their own licenses; PLATFORM_ADMIN can view all or filter by ?organizationId=.
 *     tags:
 *       - Licenses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ["PENDING", "APPROVED", "REJECTED"] }
 *       - in: query
 *         name: organizationId
 *         schema: { type: string, format: uuid }
 *         description: Filter by organization (PLATFORM_ADMIN only)
 *     responses:
 *       200:
 *         description: Paginated license list
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
 * @openapi
 * /api/v1/licenses/{id}:
 *   get:
 *     summary: Get license details
 *     description: Retrieves a single license by ID. Strictly tenant-isolated (cross-tenant reads return 404).
 *     tags:
 *       - Licenses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: License details
 *       404:
 *         description: License not found or access denied
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
 * @openapi
 * /api/v1/licenses/{id}:
 *   patch:
 *     summary: Review hospital license
 *     description: Approves or rejects a hospital compliance license. Restricted to PLATFORM_ADMIN.
 *     tags:
 *       - Licenses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: ["APPROVED", "REJECTED"] }
 *               rejectionReason: { type: string, description: "Required if status is REJECTED" }
 *     responses:
 *       200:
 *         description: License review status updated
 *       400:
 *         description: Validation error (e.g. missing rejection reason)
 *       403:
 *         description: Forbidden (insufficient privileges)
 *       404:
 *         description: License not found
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
