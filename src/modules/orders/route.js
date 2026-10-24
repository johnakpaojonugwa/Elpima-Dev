import { Router } from "express";

import { prisma } from "../../config/prisma.js";
import {
  OrderIdParamSchema,
  ListOrdersQuerySchema,
  UpdateOrderStatusSchema,
} from "./validation.js";
import {
  listOrders,
  getOrderById,
  updateOrderStatus,
} from "./service.js";

// =====================================================================
// Orders router — /api/v1/orders (Phase 4)
// =====================================================================
//
// Mount site in src/routes/index.js applies `requireAuth`.
//
// Role & Access Gates:
//   - GET /: Scoped to buyer (hospital) or seller (vendor)
//   - GET /:id: Scoped to buyer (hospital) or seller (vendor)
//   - PATCH /:id: Vendor can CONFIRM or FULFILL; Hospital can CANCEL

export const ordersRouter = Router();

/**
 * GET /api/v1/orders
 *
 * Lists orders with dual-tenant isolation.
 */
ordersRouter.get("/", async (req, res, next) => {
  try {
    const query = ListOrdersQuerySchema.parse(req.query);

    const { items, nextCursor, limit } = await listOrders(
      prisma,
      query,
      req.user,
    );

    res.status(200).json({
      success: true,
      data: { orders: items },
      orders: items, // backward-compatible alias
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
 * GET /api/v1/orders/:id
 *
 * Fetches single order details by ID with bi-tenant guard.
 */
ordersRouter.get("/:id", async (req, res, next) => {
  try {
    const { id } = OrderIdParamSchema.parse(req.params);

    const order = await getOrderById(prisma, id, req.user);

    res.status(200).json({
      success: true,
      data: { order },
      order, // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/orders/:id
 *
 * Updates order status (CONFIRMED, FULFILLED, CANCELLED).
 */
ordersRouter.patch("/:id", async (req, res, next) => {
  try {
    const { id } = OrderIdParamSchema.parse(req.params);
    const { status } = UpdateOrderStatusSchema.parse(req.body);

    const order = await updateOrderStatus(prisma, id, status, {
      id: req.user.id ?? null,
      supabaseUserId: req.user.supabaseUserId,
      role: req.user.role,
      organizationId: req.user.organizationId,
    });

    res.status(200).json({
      success: true,
      data: { order },
      order, // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});
