import { z } from "zod";

// =====================================================================
// License Zod validation schemas (Phase 3)
// =====================================================================
//
// Governs hospital verification document submissions and review workflow.
// Enforces:
//   - Strict UUID validation for organization and license IDs
//   - URL or Storage URI validation for document links
//   - Rejection reason conditionally required when status is REJECTED
//   - Strict payload sanitization (.strict())

const uuidSchema = z.string().uuid({ message: "id must be a valid UUID" });

export const CreateLicenseSchema = z
  .object({
    organizationId: uuidSchema.optional(), // Can also be derived from request.user or route params
    licenseNumber: z
      .string({ required_error: "licenseNumber is required" })
      .trim()
      .min(2, { message: "licenseNumber must be at least 2 characters" })
      .max(100),
    issuingBody: z
      .string({ required_error: "issuingBody is required" })
      .trim()
      .min(2, { message: "issuingBody must be at least 2 characters" })
      .max(255),
    documentUrl: z
      .string({ required_error: "documentUrl is required" })
      .trim()
      .url({ message: "documentUrl must be a valid URL" }),
    expiresAt: z
      .string()
      .datetime({ message: "expiresAt must be a valid ISO datetime string" })
      .optional()
      .nullable(),
  })
  .strict();

export const ReviewLicenseSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"], {
      required_error: "status must be either APPROVED or REJECTED",
    }),
    rejectionReason: z
      .string()
      .trim()
      .min(3, { message: "rejectionReason must be at least 3 characters when provided" })
      .max(500)
      .optional()
      .nullable(),
  })
  .strict()
  .refine(
    (reviewPayload) => {
      if (reviewPayload.status === "REJECTED") {
        return typeof reviewPayload.rejectionReason === "string" && reviewPayload.rejectionReason.trim().length >= 3;
      }
      return true;
    },
    {
      message: "rejectionReason is required when status is REJECTED",
      path: ["rejectionReason"],
    },
  );

export const LicenseIdParameterSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

export const LicenseIdParamSchema = LicenseIdParameterSchema;

export const ListLicensesQuerySchema = z
  .object({
    cursor: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    organizationId: uuidSchema.optional(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]).optional(),
  })
  .strict();
