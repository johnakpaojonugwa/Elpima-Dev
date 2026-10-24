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
 * @openapi
 * /api/v1/products:
 *   post:
 *     summary: Create a product in the catalog
 *     description: Creates a new medical equipment/surgical consumable listing. Restricted to VENDOR organizations.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, unitPrice]
 *             properties:
 *               name: { type: string, example: "Surgical Gloves (Size 7.5)" }
 *               description: { type: string, example: "Powder-free sterile latex gloves, box of 100" }
 *               sku: { type: string, example: "GLV-ST-75" }
 *               unitPrice: { type: number, example: 4500.00 }
 *               currency: { type: string, default: "NGN", example: "NGN" }
 *               stockQuantity: { type: integer, example: 500 }
 *               categoryId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Product created successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden (HOSPITAL users cannot create products)
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
 * @openapi
 * /api/v1/products:
 *   get:
 *     summary: Browse catalog products
 *     description: Returns cross-tenant product catalog with cursor pagination, text search, and category filtering.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema: { type: string, format: uuid }
 *         description: Pagination cursor (id of the last item from previous page)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search keyword matching product name or SKU
 *       - in: query
 *         name: categoryId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: vendorId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Paginated product list
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
 * @openapi
 * /api/v1/products/{id}:
 *   get:
 *     summary: Get product details
 *     description: Retrieves details of a single product.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Product found
 *       404:
 *         description: Product not found
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
 * @openapi
 * /api/v1/products/{id}:
 *   patch:
 *     summary: Update a product
 *     description: Updates product metadata, price, or inventory. Only owning vendor can update.
 *     tags:
 *       - Products
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
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               unitPrice: { type: number }
 *               currency: { type: string }
 *               stockQuantity: { type: integer }
 *               isAvailable: { type: boolean }
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       404:
 *         description: Product not found or belongs to another vendor
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
 * @openapi
 * /api/v1/products/{id}:
 *   delete:
 *     summary: Delete a product
 *     description: Removes a product from the catalog. Restricted to the owning vendor.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Product deleted
 *       404:
 *         description: Product not found or cross-tenant delete attempt
 *       409:
 *         description: Conflict (Product is referenced in existing quotes or orders)
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
