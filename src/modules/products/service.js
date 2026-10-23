import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "../../utils/AppError.js";

// =====================================================================
// Products service — business logic for vendor catalog (Phase 2)
// =====================================================================

/**
 * Create a new product in the vendor's catalog.
 *
 * @param {import("@prisma/client").PrismaClient} db
 * @param {string} vendorId
 * @param {object} input
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<object>} The created product
 */
export async function createProduct(db, vendorId, input, actor) {
  try {
    const product = await db.product.create({
      data: {
        vendorId,
        categoryId: input.categoryId ?? null,
        name: input.name,
        description: input.description ?? null,
        sku: input.sku ?? null,
        imageUrl: input.imageUrl ?? null,
        unitPrice: input.unitPrice,
        currency: input.currency ?? "NGN",
        inStock: input.inStock ?? true,
        minOrderQty: input.minOrderQty ?? 1,
      },
      select: {
        id: true,
        vendorId: true,
        categoryId: true,
        name: true,
        description: true,
        sku: true,
        imageUrl: true,
        unitPrice: true,
        currency: true,
        inStock: true,
        minOrderQty: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await db.auditLog.create({
      data: {
        organizationId: actor?.organizationId ?? vendorId,
        userId: actor?.id ?? null,
        action: "create",
        entityType: "product",
        entityId: product.id,
        metadata: {
          productName: product.name,
          vendorId,
          actorRole: actor?.role ?? "ORG_ADMIN",
        },
      },
      select: { id: true },
    });

    return product;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        throw new AppError(400, "Referenced category or vendor does not exist");
      }
    }
    throw err;
  }
}

/**
 * List products across the platform with pagination and filtering.
 *
 * @param {import("@prisma/client").PrismaClient} db
 * @param {object} query Validated ListProductsQuerySchema
 * @returns {Promise<{ items: object[], nextCursor: string|null, limit: number }>}
 */
export async function listProducts(db, query) {
  const { cursor, limit = 20, categoryId, vendorId, inStock, q } = query;

  const where = {
    ...(categoryId ? { categoryId } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(inStock !== undefined ? { inStock } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const products = await db.product.findMany({
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    where,
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true, city: true, state: true } },
    },
  });

  const hasMore = products.length > limit;
  const items = hasMore ? products.slice(0, limit) : products;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, limit };
}

/**
 * Retrieve a single product by ID.
 *
 * @param {import("@prisma/client").PrismaClient} db
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function getProductById(db, id) {
  const product = await db.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      vendor: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          state: true,
        },
      },
    },
  });

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  return product;
}

/**
 * Update an existing product. Only the owning vendor (or PLATFORM_ADMIN) may update.
 *
 * @param {import("@prisma/client").PrismaClient} db
 * @param {string} id
 * @param {string} vendorId
 * @param {object} input Validated UpdateProductSchema
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<object>}
 */
export async function updateProduct(db, id, vendorId, input, actor) {
  const existing = await db.product.findUnique({
    where: { id },
    select: { id: true, vendorId: true },
  });

  if (!existing) {
    throw new AppError(404, "Product not found");
  }

  if (actor.role !== "PLATFORM_ADMIN" && existing.vendorId !== vendorId) {
    throw new AppError(404, "Product not found");
  }

  try {
    const product = await db.product.update({
      where: { id },
      data: input,
      include: {
        category: { select: { id: true, name: true } },
      },
    });

    await db.auditLog.create({
      data: {
        organizationId: actor?.organizationId ?? vendorId,
        userId: actor?.id ?? null,
        action: "update",
        entityType: "product",
        entityId: product.id,
        metadata: {
          updatedFields: Object.keys(input),
          actorRole: actor?.role ?? "ORG_ADMIN",
        },
      },
      select: { id: true },
    });

    return product;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        throw new AppError(400, "Referenced category does not exist");
      }
    }
    throw err;
  }
}

/**
 * Delete a product. Only the owning vendor (or PLATFORM_ADMIN) may delete.
 *
 * @param {import("@prisma/client").PrismaClient} db
 * @param {string} id
 * @param {string} vendorId
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<{ id: string }>}
 */
export async function deleteProduct(db, id, vendorId, actor) {
  const existing = await db.product.findUnique({
    where: { id },
    select: { id: true, vendorId: true, name: true },
  });

  if (!existing) {
    throw new AppError(404, "Product not found");
  }

  if (actor.role !== "PLATFORM_ADMIN" && existing.vendorId !== vendorId) {
    throw new AppError(404, "Product not found");
  }

  try {
    await db.product.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new AppError(409, "Cannot delete product referenced in existing quotes or orders");
    }
    throw err;
  }

  await db.auditLog.create({
    data: {
      organizationId: actor?.organizationId ?? vendorId,
      userId: actor?.id ?? null,
      action: "delete",
      entityType: "product",
      entityId: id,
      metadata: {
        deletedProductName: existing.name,
        actorRole: actor?.role ?? "ORG_ADMIN",
      },
    },
    select: { id: true },
  });

  return { id };
}
