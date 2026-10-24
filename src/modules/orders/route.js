import { Router } from "express";

import { prisma } from "../../config/prisma.js";
import {
  OrderIdParameterSchema,
  OrderIdParamSchema,
  ListOrdersQuerySchema,
  UpdateOrderStatusSchema,
} from "./validation.js";
import {
  listOrders,
  getOrderById,
  updateOrderStatus,
} from "./service.js";
import {
  formatOrderConfirmedWhatsAppMessage,
  createWhatsAppChatLink,
} from "../../services/whatsapp.service.js";

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
ordersRouter.get("/", async (request, response, next) => {
  try {
    const queryParameters = ListOrdersQuerySchema.parse(request.query);

    const { items, nextCursor, limit } = await listOrders(
      prisma,
      queryParameters,
      request.user,
    );

    response.status(200).json({
      success: true,
      data: { orders: items },
      orders: items, // backward-compatible alias
      meta: {
        pagination: {
          nextCursor,
          limit,
        },
        ...(request.correlationId ? { correlationId: request.correlationId } : {}),
      },
    });
  } catch (error) {
    next(error);
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
ordersRouter.get("/:id", async (request, response, next) => {
  try {
    const { id: orderId } = OrderIdParameterSchema.parse(request.params);

    const order = await getOrderById(prisma, orderId, request.user);

    response.status(200).json({
      success: true,
      data: { order },
      order, // backward-compatible alias
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
ordersRouter.patch("/:id", async (request, response, next) => {
  try {
    const { id: orderId } = OrderIdParameterSchema.parse(request.params);
    const { status } = UpdateOrderStatusSchema.parse(request.body);

    const order = await updateOrderStatus(prisma, orderId, status, {
      id: request.user.id ?? null,
      supabaseUserId: request.user.supabaseUserId,
      role: request.user.role,
      organizationId: request.user.organizationId,
    });

    response.status(200).json({
      success: true,
      data: { order },
      order, // backward-compatible alias
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
 * /api/v1/orders/{id}/whatsapp-link:
 *   get:
 *     summary: Generate standard WhatsApp purchase order notification link
 *     description: Generates an official wa.me universal Click-to-Chat deep link with prefilled purchase order confirmation text for standard/personal WhatsApp.
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
 *         description: WhatsApp Click-to-Chat URL and prefilled text generated
 *       404:
 *         description: Order not found
 */
ordersRouter.get("/:id/whatsapp-link", async (request, response, next) => {
  try {
    const { id: orderId } = OrderIdParameterSchema.parse(request.params);
    const order = await getOrderById(prisma, orderId, request.user);

    const isCallerHospital = request.user.organizationId === order.hospitalId;
    const recipientOrg = isCallerHospital ? order.quote.vendor : order.hospital;

    const message = formatOrderConfirmedWhatsAppMessage({
      orderId: order.id,
      quoteId: order.quoteId,
      hospitalName: order.hospital.name,
      vendorName: order.quote.vendor.name,
      totalAmount: order.totalAmount,
      currency: order.currency,
    });

    const whatsappUrl = createWhatsAppChatLink(recipientOrg.phone, message);

    response.status(200).json({
      success: true,
      data: {
        whatsappUrl,
        message,
        recipientPhone: recipientOrg.phone,
      },
      meta: {
        ...(request.correlationId ? { correlationId: request.correlationId } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
});
