import { AppError } from "../../utils/AppError.js";

// =====================================================================
// Orders service — order tracking & fulfillment (Phase 4)
// =====================================================================
//
// Governs verified purchase orders generated from accepted quotes.
// Enforces:
//   - Bi-tenant isolation (purchasing hospital & supplying vendor only)
//   - Anti-enumeration (cross-tenant accesses return 404)
//   - Strict state transitions (PENDING -> CONFIRMED -> FULFILLED, or PENDING -> CANCELLED)
//   - Comprehensive audit logging

/**
 * List orders with dual-tenant scoping.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {object} queryParameters Validated ListOrdersQuerySchema
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<{ items: object[], nextCursor: string|null, limit: number }>}
 */
export async function listOrders(databaseClient, queryParameters, actor) {
  const { cursor, limit = 20, status } = queryParameters;

  const isPlatformAdmin = actor?.role === "PLATFORM_ADMIN";

  const where = {
    ...(status ? { status } : {}),
  };

  if (!isPlatformAdmin) {
    const organization = await databaseClient.organization.findUnique({
      where: { id: actor.organizationId },
      select: { type: true },
    });

    if (organization?.type === "HOSPITAL") {
      where.hospitalId = actor.organizationId;
    } else if (organization?.type === "VENDOR") {
      where.quote = { vendorId: actor.organizationId };
    } else {
      where.hospitalId = actor.organizationId;
    }
  }

  const orders = await databaseClient.order.findMany({
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
      quote: {
        select: {
          id: true,
          status: true,
          vendor: { select: { id: true, name: true, city: true, state: true } },
        },
      },
      hospital: {
        select: { id: true, name: true, city: true, state: true },
      },
    },
  });

  const hasMore = orders.length > limit;
  const items = hasMore ? orders.slice(0, limit) : orders;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, limit };
}

/**
 * Retrieve order details by ID with bi-tenant scoping and audit log.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {string} orderId Order UUID
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<object>}
 */
export async function getOrderById(databaseClient, orderId, actor) {
  const order = await databaseClient.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, imageUrl: true } },
        },
      },
      quote: {
        include: {
          vendor: { select: { id: true, name: true, email: true, phone: true, city: true, state: true } },
        },
      },
      hospital: {
        select: { id: true, name: true, email: true, phone: true, city: true, state: true },
      },
    },
  });

  if (!order) {
    throw new AppError(404, "Order not found");
  }

  const isPlatformAdmin = actor?.role === "PLATFORM_ADMIN";
  const isAuthorized =
    isPlatformAdmin ||
    order.hospitalId === actor.organizationId ||
    order.quote?.vendorId === actor.organizationId;

  if (!isAuthorized) {
    throw new AppError(404, "Order not found");
  }

  // Audit read
  await databaseClient.auditLog.create({
    data: {
      organizationId: actor.organizationId ?? order.hospitalId,
      userId: actor?.id ?? null,
      action: "read",
      entityType: "order",
      entityId: orderId,
      metadata: {
        actorRole: actor?.role ?? "ORG_STAFF",
      },
    },
    select: { id: true },
  });

  return order;
}

/**
 * Update order fulfillment status.
 *
 * @param {import("@prisma/client").PrismaClient} databaseClient
 * @param {string} orderId Order UUID
 * @param {string} newStatus "CONFIRMED" | "FULFILLED" | "CANCELLED"
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 * @returns {Promise<object>}
 */
export async function updateOrderStatus(databaseClient, orderId, newStatus, actor) {
  const order = await databaseClient.order.findUnique({
    where: { id: orderId },
    include: {
      quote: { select: { vendorId: true } },
    },
  });

  if (!order) {
    throw new AppError(404, "Order not found");
  }

  const isPlatformAdmin = actor?.role === "PLATFORM_ADMIN";

  // Authorization checks
  if (!isPlatformAdmin) {
    if (newStatus === "CONFIRMED" || newStatus === "FULFILLED") {
      if (order.quote.vendorId !== actor.organizationId) {
        throw new AppError(403, "Only the supplying vendor can confirm or fulfill an order");
      }
    }
    if (newStatus === "CANCELLED") {
      if (order.hospitalId !== actor.organizationId) {
        throw new AppError(403, "Only the purchasing hospital can cancel an order");
      }
    }
  }

  if (order.status === newStatus) {
    throw new AppError(409, `Order is already in ${newStatus} status`);
  }

  // Transition validation
  if (newStatus === "CONFIRMED" && order.status !== "PENDING") {
    throw new AppError(400, `Cannot confirm order in ${order.status} status; only PENDING orders can be confirmed`);
  }

  if (newStatus === "FULFILLED" && order.status !== "CONFIRMED") {
    throw new AppError(400, `Cannot fulfill order in ${order.status} status; order must first be CONFIRMED`);
  }

  if (newStatus === "CANCELLED" && order.status !== "PENDING") {
    throw new AppError(400, `Cannot cancel order in ${order.status} status; confirmed or fulfilled orders cannot be cancelled`);
  }

  const updatedOrder = await databaseClient.order.update({
    where: { id: orderId },
    data: { status: newStatus },
    include: {
      items: true,
      quote: { select: { id: true, vendor: { select: { id: true, name: true } } } },
      hospital: { select: { id: true, name: true } },
    },
  });

  await databaseClient.auditLog.create({
    data: {
      organizationId: actor?.organizationId ?? order.hospitalId,
      userId: actor?.id ?? null,
      action: "update_status",
      entityType: "order",
      entityId: orderId,
      metadata: {
        previousStatus: order.status,
        newStatus,
        actorRole: actor?.role ?? "ORG_ADMIN",
      },
    },
    select: { id: true },
  });

  return updatedOrder;
}
