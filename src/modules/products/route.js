import { Router } from "express";

import { prisma } from "../../config/prisma.js";
import {
  CreateProductSchema,
  UpdateProductSchema,
  ProductIdParamSchema,
  ListProductsQuerySchema,
} from "./validation.js";
import {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} from "./service.js";
import { requireOrgType } from "../../middlewares/auth.js";

// =====================================================================
// Products router — /api/v1/products (Phase 2)
// =====================================================================
//
// Mount site in src/routes/index.js applies `requireAuth`.
//
// RBAC & OrgType Gates:
//   - POST /: VENDOR only (requireOrgType("VENDOR"))
//   - GET /: Any authenticated user (Hospitals browse vendor catalogs)
//   - GET /:id: Any authenticated user
//   - PATCH /:id: VENDOR only (owning vendor)
//   - DELETE /:id: VENDOR only (owning vendor)

export const productsRouter = Router();

/**
 * POST /api/v1/products
 *
 * Creates a new catalog product for the authenticated vendor.
 */
productsRouter.post("/", requireOrgType("VENDOR"), async (req, res, next) => {
  try {
    const input = CreateProductSchema.parse(req.body);

    const product = await createProduct(
      prisma,
      req.user.organizationId,
      input,
      {
        role: req.user.role,
        id: null,
        organizationId: req.user.organizationId,
      },
    );

    res.status(201).json({
      success: true,
      data: { product },
      product, // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/products
 *
 * Browses catalog products across all vendors with pagination & filtering.
 */
productsRouter.get("/", async (req, res, next) => {
  try {
    const query = ListProductsQuerySchema.parse(req.query);

    const { items, nextCursor, limit } = await listProducts(prisma, query);

    res.status(200).json({
      success: true,
      data: { products: items },
      products: items, // backward-compatible alias
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
 * GET /api/v1/products/:id
 *
 * Fetches single product details.
 */
productsRouter.get("/:id", async (req, res, next) => {
  try {
    const { id } = ProductIdParamSchema.parse(req.params);

    const product = await getProductById(prisma, id);

    res.status(200).json({
      success: true,
      data: { product },
      product, // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/products/:id
 *
 * Updates product details. Only owning vendor (or PLATFORM_ADMIN) may update.
 */
productsRouter.patch("/:id", requireOrgType("VENDOR"), async (req, res, next) => {
  try {
    const { id } = ProductIdParamSchema.parse(req.params);
    const input = UpdateProductSchema.parse(req.body);

    const product = await updateProduct(
      prisma,
      id,
      req.user.organizationId,
      input,
      {
        role: req.user.role,
        id: null,
        organizationId: req.user.organizationId,
      },
    );

    res.status(200).json({
      success: true,
      data: { product },
      product, // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/products/:id
 *
 * Deletes a product. Only owning vendor (or PLATFORM_ADMIN) may delete.
 */
productsRouter.delete("/:id", requireOrgType("VENDOR"), async (req, res, next) => {
  try {
    const { id } = ProductIdParamSchema.parse(req.params);

    await deleteProduct(prisma, id, req.user.organizationId, {
      role: req.user.role,
      id: null,
      organizationId: req.user.organizationId,
    });

    res.status(200).json({
      success: true,
      data: { message: "Product deleted successfully" },
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});
