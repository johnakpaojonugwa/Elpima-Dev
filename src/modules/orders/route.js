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
 * @openapi
 * /api/v1/orders:
 *   get:
 *     summary: List purchase orders
 *     description: Retrieves orders with bi-tenant scoping. Hospitals see orders they have placed; Vendors see orders for their products.
 *     tags:
 *       - Orders
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
 *         schema: { type: string, enum: ["PENDING", "CONFIRMED", "FULFILLED", "CANCELLED"] }
 *     responses:
 *       200:
 *         description: Paginated order list
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
 * @openapi
 * /api/v1/orders/{id}:
 *   get:
 *     summary: Get purchase order details
 *     description: Retrieves order details and item lines. Strictly scoped to the purchasing hospital or supplying vendor.
 *     tags:
 *       - Orders
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Order details
 *       404:
 *         description: Order not found or unauthorized
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
 * @openapi
 * /api/v1/orders/{id}:
 *   patch:
 *     summary: Update order fulfillment status
 *     description: Transitions order status. Supplying vendor can confirm (CONFIRMED) or fulfill (FULFILLED). Purchasing hospital can cancel (CANCELLED) if pending.
 *     tags:
 *       - Orders
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
 *               status: { type: string, enum: ["CONFIRMED", "FULFILLED", "CANCELLED"] }
 *     responses:
 *       200:
 *         description: Order status updated successfully
 *       400:
 *         description: Invalid state transition
 *       403:
 *         description: Forbidden (Caller not permitted to execute transition)
 *       404:
 *         description: Order not found
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
