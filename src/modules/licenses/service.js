import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../utils/logger.js";
import { sendLicenseReviewAlert } from "../../services/email.service.js";

// =====================================================================
// Licenses service — hospital verification compliance (Phase 3)
// =====================================================================
//
// Regulates verification documents for healthcare institutions.
// Complies with:
//   - Strict tenant isolation (Hospitals cannot access another hospital's licenses)
//   - Anti-enumeration (cross-tenant accesses return 404)
//   - Immutable audit logging for create, read, and review transitions

/**
 * Submit a new hospital license for verification.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {string} organizationId Hospital tenant ID
 * @param {object} input Validated CreateLicenseSchema
 * @param {{ id: string|null, role: string, organizationId: string|null, supabaseUserId?: string }} actor
 * @returns {Promise<object>} Created license record
 */
export async function createLicense(databaseClient, organizationId, input, actor) {
  // Verify target organization exists and is a HOSPITAL
  const organization = await databaseClient.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, type: true },
  });

  if (!organization) {
    throw new AppError(404, "Organization not found");
  }

  if (organization.type !== "HOSPITAL") {
    throw new AppError(400, "Licenses can only be submitted for hospital organizations");
  }

  const license = await databaseClient.license.create({
    data: {
      organizationId,
      licenseNumber: input.licenseNumber,
      issuingBody: input.issuingBody,
      documentUrl: input.documentUrl,
      status: "PENDING",
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    },
    select: {
      id: true,
      organizationId: true,
      licenseNumber: true,
      issuingBody: true,
      documentUrl: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await databaseClient.auditLog.create({
    data: {
      organizationId,
      userId: actor?.id ?? null,
      action: "create",
      entityType: "license",
      entityId: license.id,
      metadata: {
        licenseNumber: license.licenseNumber,
        issuingBody: license.issuingBody,
        actorRole: actor?.role ?? "ORG_ADMIN",
      },
    },
    select: { id: true },
  });

  return license;
}

/**
 * List licenses with tenant isolation and status filters.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {object} queryParameters Validated ListLicensesQuerySchema
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<{ items: object[], nextCursor: string|null, limit: number }>}
 */
export async function listLicenses(databaseClient, queryParameters, actor) {
  const { cursor, limit = 20, organizationId, status } = queryParameters;

  const isPlatformAdmin = actor?.role === "PLATFORM_ADMIN";

  // Enforce tenant boundary: non-platform admin can only list their own licenses
  if (!isPlatformAdmin) {
    if (organizationId && organizationId !== actor.organizationId) {
      throw new AppError(404, "Organization not found");
    }
  }

  const effectiveOrgId = isPlatformAdmin
    ? organizationId
    : actor.organizationId;

  const where = {
    ...(effectiveOrgId ? { organizationId: effectiveOrgId } : {}),
    ...(status ? { status } : {}),
  };

  const licenses = await databaseClient.license.findMany({
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      licenseNumber: true,
      issuingBody: true,
      documentUrl: true,
      status: true,
      expiresAt: true,
      reviewedBy: true,
      reviewedAt: true,
      rejectionReason: true,
      createdAt: true,
      updatedAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          city: true,
          state: true,
        },
      },
    },
  });

  const hasMore = licenses.length > limit;
  const items = hasMore ? licenses.slice(0, limit) : licenses;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, limit };
}

/**
 * Retrieve license details by ID with tenant guard and audit log.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {string} licenseId License UUID
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<object>} License record
 */
export async function getLicenseById(databaseClient, licenseId, actor) {
  const license = await databaseClient.license.findUnique({
    where: { id: licenseId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          type: true,
          city: true,
          state: true,
        },
      },
    },
  });

  if (!license) {
    throw new AppError(404, "License not found");
  }

  const isPlatformAdmin = actor?.role === "PLATFORM_ADMIN";
  if (!isPlatformAdmin && license.organizationId !== actor.organizationId) {
    throw new AppError(404, "License not found");
  }

  // Audit read for medical compliance
  await databaseClient.auditLog.create({
    data: {
      organizationId: license.organizationId,
      userId: actor?.id ?? null,
      action: "read",
      entityType: "license",
      entityId: license.id,
      metadata: {
        actorRole: actor?.role ?? "ORG_STAFF",
      },
    },
    select: { id: true },
  });

  return license;
}

/**
 * Review a hospital license (PLATFORM_ADMIN only).
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {string} licenseId License UUID
 * @param {object} input Validated ReviewLicenseSchema
 * @param {{ id: string|null, role: string, organizationId: string|null, supabaseUserId?: string }} actor
 * @returns {Promise<object>} Updated license record
 */
export async function reviewLicense(databaseClient, licenseId, input, actor) {
  const license = await databaseClient.license.findUnique({
    where: { id: licenseId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      organization: { select: { id: true, name: true, email: true } },
    },
  });

  if (!license) {
    throw new AppError(404, "License not found");
  }

  if (license.status !== "PENDING") {
    throw new AppError(400, `Cannot review license in ${license.status} status; only PENDING licenses can be reviewed`);
  }

  const reviewerId = actor?.supabaseUserId ?? actor?.id ?? "PLATFORM_ADMIN";

  const updated = await databaseClient.license.update({
    where: { id: licenseId },
    data: {
      status: input.status,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      rejectionReason: input.status === "REJECTED" ? input.rejectionReason : null,
    },
    select: {
      id: true,
      organizationId: true,
      licenseNumber: true,
      issuingBody: true,
      documentUrl: true,
      status: true,
      expiresAt: true,
      reviewedBy: true,
      reviewedAt: true,
      rejectionReason: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await databaseClient.auditLog.create({
    data: {
      organizationId: license.organizationId,
      userId: actor?.id ?? null,
      action: "review",
      entityType: "license",
      entityId: licenseId,
      metadata: {
        previousStatus: license.status,
        newStatus: input.status,
        reviewerId,
        rejectionReason: input.rejectionReason ?? null,
      },
    },
    select: { id: true },
  });

  // Asynchronously dispatch license review email alert to hospital
  if (license.organization?.email) {
    sendLicenseReviewAlert({
      to: license.organization.email,
      hospitalName: license.organization.name,
      status: input.status,
      rejectionReason: input.rejectionReason,
    }).catch((error) => {
      logger.warn("Failed to dispatch license review email", {
        licenseId,
        error: error.message,
      });
    });
  }

  return updated;
}
