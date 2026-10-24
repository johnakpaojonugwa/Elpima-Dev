import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { AppError } from "../../utils/AppError.js";
import { prisma } from "../../config/prisma.js";
import {
  uploadLicenseDocument,
  createLicenseSignedUrl,
  uploadProductImage,
} from "./service.js";

export const storageRouter = Router();

// In-memory Multer storage keeps buffers without writing scratch files to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB maximum
  },
});

const ALLOWED_LICENSE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const ALLOWED_PRODUCT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const SignedUrlQuerySchema = z.object({
  path: z.string().min(1, "Storage path is required"),
  expiresIn: z.coerce.number().int().min(60).max(86400).default(900),
});

/**
 * Helper to resolve user organization type (via claim or DB lookup).
 */
async function resolveOrgType(user) {
  if (user.organizationType) {
    return user.organizationType;
  }
  if (!user.organizationId) {
    return null;
  }
  const org = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { type: true },
  });
  return org?.type || null;
}

/**
 * @openapi
 * /api/v1/storage/licenses:
 *   post:
 *     summary: Upload medical compliance license
 *     description: Uploads a verification document (PDF, PNG, JPEG) to private Supabase storage. Restricted to hospitals.
 *     tags:
 *       - Storage
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 *       400:
 *         description: Invalid file format or missing file
 *       403:
 *         description: Forbidden (only hospitals may upload compliance licenses)
 */
storageRouter.post(
  "/licenses",
  upload.single("file"),
  async (request, response, next) => {
    try {
      if (!request.file) {
        throw new AppError(400, "No file uploaded. Please attach a file under the 'file' field.");
      }

      if (!ALLOWED_LICENSE_TYPES.includes(request.file.mimetype)) {
        throw new AppError(
          400,
          `Invalid file type '${request.file.mimetype}'. Allowed types: PDF, JPEG, PNG, WEBP.`
        );
      }

      const isPlatformAdmin = request.user.role === "PLATFORM_ADMIN";
      const orgType = await resolveOrgType(request.user);

      if (!isPlatformAdmin && orgType !== "HOSPITAL") {
        throw new AppError(403, "Only hospital organizations can upload compliance licenses.");
      }

      const organizationId = request.user.organizationId;
      if (!organizationId) {
        throw new AppError(400, "User must belong to an organization to upload documents.");
      }

      const result = await uploadLicenseDocument({
        buffer: request.file.buffer,
        originalName: request.file.originalname,
        mimeType: request.file.mimetype,
        organizationId,
      });

      response.status(201).json({
        success: true,
        data: result,
        meta: {
          ...(request.correlationId ? { correlationId: request.correlationId } : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @openapi
 * /api/v1/storage/licenses/signed-url:
 *   get:
 *     summary: Get signed URL for private license document
 *     description: Generates a temporary, cryptographically-signed access URL to view a private compliance document.
 *     tags:
 *       - Storage
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: expiresIn
 *         schema: { type: integer, default: 900 }
 *     responses:
 *       200:
 *         description: Signed URL generated
 *       403:
 *         description: Forbidden (cross-tenant access denied)
 */
storageRouter.get("/licenses/signed-url", async (request, response, next) => {
  try {
    const { path: storagePath, expiresIn } = SignedUrlQuerySchema.parse(request.query);

    const isPlatformAdmin = request.user.role === "PLATFORM_ADMIN";
    const userOrgId = request.user.organizationId;

    // Zero-trust tenant scoping: storage paths are prefixed with organizationId
    // (e.g. "<hospitalId>/<uuid>.pdf"). If caller is not platform admin, path must match caller org.
    if (!isPlatformAdmin) {
      const pathOrgId = storagePath.split("/")[0];
      if (pathOrgId !== userOrgId) {
        throw new AppError(403, "You do not have permission to view documents from another organization.");
      }
    }

    const result = await createLicenseSignedUrl(storagePath, expiresIn);

    response.status(200).json({
      success: true,
      data: result,
      meta: {
        ...(request.correlationId ? { correlationId: request.correlationId } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/v1/storage/products:
 *   post:
 *     summary: Upload product catalog image
 *     description: Uploads a product photo (JPEG, PNG, WEBP) to Supabase storage. Restricted to vendors.
 *     tags:
 *       - Storage
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Image uploaded successfully
 *       400:
 *         description: Invalid file format or missing file
 *       403:
 *         description: Forbidden (only vendors may upload product images)
 */
storageRouter.post(
  "/products",
  upload.single("file"),
  async (request, response, next) => {
    try {
      if (!request.file) {
        throw new AppError(400, "No file uploaded. Please attach an image under the 'file' field.");
      }

      if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(request.file.mimetype)) {
        throw new AppError(
          400,
          `Invalid file type '${request.file.mimetype}'. Allowed types: JPEG, PNG, WEBP.`
        );
      }

      const isPlatformAdmin = request.user.role === "PLATFORM_ADMIN";
      const orgType = await resolveOrgType(request.user);

      if (!isPlatformAdmin && orgType !== "VENDOR") {
        throw new AppError(403, "Only vendor organizations can upload product catalog images.");
      }

      const organizationId = request.user.organizationId;
      if (!organizationId) {
        throw new AppError(400, "User must belong to an organization to upload product images.");
      }

      const result = await uploadProductImage({
        buffer: request.file.buffer,
        originalName: request.file.originalname,
        mimeType: request.file.mimetype,
        organizationId,
      });

      response.status(201).json({
        success: true,
        data: result,
        meta: {
          ...(request.correlationId ? { correlationId: request.correlationId } : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
