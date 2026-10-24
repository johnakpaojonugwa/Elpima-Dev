import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../utils/logger.js";
import {
  sendNewQuoteAlert,
  sendQuotePricingReadyAlert,
  sendOrderConfirmedAlert,
} from "../../services/email.service.js";

// =====================================================================
// Quotes service — procurement workflow & RFQs (Phase 4)
// =====================================================================
//
// Governs medical equipment RFQs, pricing calculations, and order creation.
// Enforces:
//   - Server-side pricing (unit prices always fetched from DB product rows)
//   - Line total and aggregate quote sum calculations
//   - Bi-tenant isolation (only purchasing hospital & receiving vendor have access)
//   - State transition validation (DRAFT -> SENT -> ACCEPTED / DECLINED)
//   - Atomic multi-table writes using Prisma transactions

/**
 * Create a new Quote / RFQ.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {string} hospitalId Hospital tenant ID
 * @param {object} input Validated CreateQuoteSchema
 * @param {{ id: string|null, role: string, organizationId: string|null, supabaseUserId?: string }} actor
 * @returns {Promise<object>} Created quote with items
 */
export async function createQuote(databaseClient, hospitalId, input, actor) {
  const { vendorId, items, notes, expiresAt } = input;

  // 1. Verify hospital and vendor
  const [hospital, vendor] = await Promise.all([
    databaseClient.organization.findUnique({
      where: { id: hospitalId },
      select: { id: true, type: true, name: true, email: true },
    }),
    databaseClient.organization.findUnique({
      where: { id: vendorId },
      select: { id: true, type: true, name: true, email: true },
    }),
  ]);

  if (!hospital || hospital.type !== "HOSPITAL") {
    throw new AppError(400, "Quotes can only be created by hospital organizations");
  }

  if (!vendor || vendor.type !== "VENDOR") {
    throw new AppError(400, "Target organization must be a verified vendor");
  }

  // 2. Fetch products and verify ownership and pricing server-side
  const productIds = items.map((quoteItem) => quoteItem.productId);
  const products = await databaseClient.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      vendorId: true,
      name: true,
      unitPrice: true,
      inStock: true,
      minOrderQty: true,
    },
  });

  if (products.length !== items.length) {
    throw new AppError(400, "One or more requested products do not exist");
  }

  const productMap = new Map(products.map((product) => [product.id, product]));

  // 3. Compute item prices and total
  let totalAmount = new Prisma.Decimal(0);
  const quoteItemsData = [];

  for (const quoteItem of items) {
    const product = productMap.get(quoteItem.productId);

    if (product.vendorId !== vendorId) {
      throw new AppError(
        400,
        `Product '${product.name}' does not belong to the specified vendor`,
      );
    }

    if (quoteItem.quantity < product.minOrderQty) {
      throw new AppError(
        400,
        `Quantity for '${product.name}' must be at least minOrderQty (${product.minOrderQty})`,
      );
    }

    const unitPrice = product.unitPrice;
    const lineTotal = unitPrice.mul(quoteItem.quantity);
    totalAmount = totalAmount.add(lineTotal);

    quoteItemsData.push({
      productId: quoteItem.productId,
      quantity: quoteItem.quantity,
      unitPrice,
      lineTotal,
    });
  }

  // 4. Atomic transaction across quotes, quote_items, and audit_logs
  const executeTransaction = async (transactionClient) => {
    const quote = await transactionClient.quote.create({
      data: {
        hospitalId,
        vendorId,
        totalAmount,
        currency: "NGN",
        status: "DRAFT",
        notes: notes ?? null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        items: {
          create: quoteItemsData,
        },
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true },
            },
          },
        },
        vendor: {
          select: { id: true, name: true, city: true, state: true },
        },
        hospital: {
          select: { id: true, name: true, city: true, state: true },
        },
      },
    });

    await transactionClient.auditLog.create({
      data: {
        organizationId: hospitalId,
        userId: actor?.id ?? null,
        action: "create",
        entityType: "quote",
        entityId: quote.id,
        metadata: {
          vendorId,
          totalAmount: totalAmount.toString(),
          itemCount: items.length,
          actorRole: actor?.role ?? "ORG_ADMIN",
        },
      },
      select: { id: true },
    });

    return quote;
  };

  let createdQuote;
  if (typeof databaseClient.$transaction === "function") {
    createdQuote = await databaseClient.$transaction(executeTransaction, {
      maxWait: 10000,
      timeout: 20000,
    });
  } else {
    createdQuote = await executeTransaction(databaseClient);
  }

  // Asynchronously dispatch transactional email alert to vendor
  if (vendor?.email) {
    sendNewQuoteAlert({
      to: vendor.email,
      vendorName: vendor.name,
      hospitalName: hospital.name,
      quoteId: createdQuote.id,
      itemsCount: items.length,
      totalAmount: createdQuote.totalAmount,
      currency: createdQuote.currency,
    }).catch((error) => {
      logger.warn("Failed to dispatch new quote alert email", {
        quoteId: createdQuote.id,
        error: error.message,
      });
    });
  }

  return createdQuote;
}

/**
 * List quotes with dual-tenant scoping.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {object} queryParameters Validated ListQuotesQuerySchema
 * @param {{ id: string|null, role: string, organizationId: string|null, organizationType?: string }} actor
 * @returns {Promise<{ items: object[], nextCursor: string|null, limit: number }>}
 */
export async function listQuotes(databaseClient, queryParameters, actor) {
  const { cursor, limit = 20, status, vendorId, hospitalId } = queryParameters;

  const isPlatformAdmin = actor?.role === "PLATFORM_ADMIN";

  const where = {
    ...(status ? { status } : {}),
  };

  if (isPlatformAdmin) {
    if (vendorId) where.vendorId = vendorId;
    if (hospitalId) where.hospitalId = hospitalId;
  } else {
    // Determine whether caller's org is acting as buyer (hospital) or seller (vendor)
    const organization = await databaseClient.organization.findUnique({
      where: { id: actor.organizationId },
      select: { type: true },
    });

    if (organization?.type === "HOSPITAL") {
      where.hospitalId = actor.organizationId;
      if (vendorId) where.vendorId = vendorId;
    } else if (organization?.type === "VENDOR") {
      where.vendorId = actor.organizationId;
      if (hospitalId) where.hospitalId = hospitalId;
    } else {
      where.hospitalId = actor.organizationId;
    }
  }

  const quotes = await databaseClient.quote.findMany({
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    where,
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
      vendor: {
        select: { id: true, name: true, city: true, state: true },
      },
      hospital: {
        select: { id: true, name: true, city: true, state: true },
      },
    },
  });

  const hasMore = quotes.length > limit;
  const items = hasMore ? quotes.slice(0, limit) : quotes;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, limit };
}

/**
 * Get quote details by ID with bi-tenant scoping and audit log.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {string} quoteId Quote UUID
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<object>}
 */
export async function getQuoteById(databaseClient, quoteId, actor) {
  const quote = await databaseClient.quote.findUnique({
    where: { id: quoteId },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, sku: true, imageUrl: true },
          },
        },
      },
      vendor: {
        select: { id: true, name: true, email: true, phone: true, city: true, state: true },
      },
      hospital: {
        select: { id: true, name: true, email: true, phone: true, city: true, state: true },
      },
      order: {
        select: { id: true, status: true, createdAt: true },
      },
    },
  });

  if (!quote) {
    throw new AppError(404, "Quote not found");
  }

  const isPlatformAdmin = actor?.role === "PLATFORM_ADMIN";
  const isAuthorized =
    isPlatformAdmin ||
    quote.hospitalId === actor.organizationId ||
    quote.vendorId === actor.organizationId;

  if (!isAuthorized) {
    throw new AppError(404, "Quote not found");
  }

  // Audit read
  await databaseClient.auditLog.create({
    data: {
      organizationId: actor.organizationId ?? quote.hospitalId,
      userId: actor?.id ?? null,
      action: "read",
      entityType: "quote",
      entityId: quoteId,
      metadata: {
        actorRole: actor?.role ?? "ORG_STAFF",
      },
    },
    select: { id: true },
  });

  return quote;
}

/**
 * Update quote status (SENT, ACCEPTED, DECLINED).
 * If status transitions to ACCEPTED, generates the corresponding Order and OrderItems atomically.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {string} quoteId Quote UUID
 * @param {string} newStatus "SENT" | "ACCEPTED" | "DECLINED"
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<object>}
 */
export async function updateQuoteStatus(databaseClient, quoteId, newStatus, actor) {
  const quote = await databaseClient.quote.findUnique({
    where: { id: quoteId },
    include: {
      items: true,
    },
  });

  if (!quote) {
    throw new AppError(404, "Quote not found");
  }

  const isPlatformAdmin = actor?.role === "PLATFORM_ADMIN";

  // Authorization rules:
  // - VENDOR can send the quote (DRAFT -> SENT)
  // - HOSPITAL can accept or decline the quote (SENT -> ACCEPTED | DECLINED)
  if (!isPlatformAdmin) {
    if (newStatus === "SENT" && quote.vendorId !== actor.organizationId) {
      throw new AppError(403, "Only the vendor can send a quote");
    }
    if ((newStatus === "ACCEPTED" || newStatus === "DECLINED") && quote.hospitalId !== actor.organizationId) {
      throw new AppError(403, "Only the purchasing hospital can accept or decline a quote");
    }
  }

  if (quote.status === newStatus) {
    throw new AppError(409, `Quote is already in ${newStatus} status`);
  }

  // Transition validations
  if (newStatus === "SENT" && quote.status !== "DRAFT") {
    throw new AppError(400, `Cannot send quote in ${quote.status} status; only DRAFT quotes can be sent`);
  }

  if ((newStatus === "ACCEPTED" || newStatus === "DECLINED") && quote.status !== "SENT" && quote.status !== "VIEWED") {
    throw new AppError(400, `Cannot ${newStatus.toLowerCase()} quote in ${quote.status} status; quote must be SENT or VIEWED`);
  }

  const executeUpdate = async (transactionClient) => {
    let order = null;

    // If accepted, generate order and order_items
    if (newStatus === "ACCEPTED") {
      order = await transactionClient.order.create({
        data: {
          quoteId: quote.id,
          hospitalId: quote.hospitalId,
          status: "PENDING",
          totalAmount: quote.totalAmount,
          items: {
            create: quote.items.map((quoteItem) => ({
              productId: quoteItem.productId,
              quantity: quoteItem.quantity,
              unitPrice: quoteItem.unitPrice,
              lineTotal: quoteItem.lineTotal,
            })),
          },
        },
        include: {
          items: true,
        },
      });
    }

    const updatedQuote = await transactionClient.quote.update({
      where: { id: quoteId },
      data: { status: newStatus },
      include: {
        items: true,
        vendor: { select: { id: true, name: true, email: true } },
        hospital: { select: { id: true, name: true, email: true } },
        order: true,
      },
    });

    await transactionClient.auditLog.create({
      data: {
        organizationId: actor?.organizationId ?? quote.hospitalId,
        userId: actor?.id ?? null,
        action: "update_status",
        entityType: "quote",
        entityId: quoteId,
        metadata: {
          previousStatus: quote.status,
          newStatus,
          createdOrderId: order?.id ?? null,
          actorRole: actor?.role ?? "ORG_ADMIN",
        },
      },
      select: { id: true },
    });

    return updatedQuote;
  };

  let result;
  if (typeof databaseClient.$transaction === "function") {
    result = await databaseClient.$transaction(executeUpdate, {
      maxWait: 10000,
      timeout: 20000,
    });
  } else {
    result = await executeUpdate(databaseClient);
  }

  // Asynchronously dispatch transactional alerts
  if (newStatus === "SENT" && result?.hospital?.email) {
    sendQuotePricingReadyAlert({
      to: result.hospital.email,
      hospitalName: result.hospital.name,
      vendorName: result.vendor.name,
      quoteId: result.id,
      totalAmount: result.totalAmount,
      currency: result.currency,
    }).catch((error) => {
      logger.warn("Failed to dispatch pricing ready email", {
        quoteId: result.id,
        error: error.message,
      });
    });
  } else if (newStatus === "ACCEPTED" && result?.vendor?.email && result?.order) {
    sendOrderConfirmedAlert({
      to: result.vendor.email,
      vendorName: result.vendor.name,
      hospitalName: result.hospital.name,
      orderId: result.order.id,
      totalAmount: result.order.totalAmount,
      currency: result.order.currency,
    }).catch((error) => {
      logger.warn("Failed to dispatch order confirmed email", {
        orderId: result.order.id,
        error: error.message,
      });
    });
  }

  return result;
}
