import { Router } from "express";

import { prisma, directPrisma } from "../../config/prisma.js";
import {
  CreateQuoteSchema,
  UpdateQuoteStatusSchema,
  QuoteIdParamSchema,
  ListQuotesQuerySchema,
} from "./validation.js";
import {
  createQuote,
  listQuotes,
  getQuoteById,
  updateQuoteStatus,
} from "./service.js";
import { requireOrgType } from "../../middlewares/auth.js";

// =====================================================================
// Quotes router — /api/v1/quotes (Phase 4)
// =====================================================================
//
// Mount site in src/routes/index.js applies `requireAuth`.
//
// Role & OrgType Gates:
//   - POST /: HOSPITAL only (requireOrgType("HOSPITAL"))
//   - GET /: Scoped to buyer (hospital) or seller (vendor)
//   - GET /:id: Scoped to buyer (hospital) or seller (vendor)
//   - PATCH /:id: Vendor can SEND; Hospital can ACCEPT or DECLINE

export const quotesRouter = Router();

/**
 * @openapi
 * /api/v1/quotes:
 *   post:
 *     summary: Request a quotation (RFQ)
 *     description: Hospital requests pricing for selected vendor products. Line totals and total amount are calculated server-side.
 *     tags:
 *       - Quotes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, items]
 *             properties:
 *               vendorId: { type: string, format: uuid }
 *               notes: { type: string, example: "Delivery needed by end of month" }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [productId, quantity]
 *                   properties:
 *                     productId: { type: string, format: uuid }
 *                     quantity: { type: integer, minimum: 1, example: 10 }
 *     responses:
 *       201:
 *         description: RFQ quote created successfully
 *       400:
 *         description: Validation error or product not found
 *       403:
 *         description: Forbidden (Vendors cannot request quotes)
 */
quotesRouter.post("/", requireOrgType("HOSPITAL"), async (req, res, next) => {
  try {
    const input = CreateQuoteSchema.parse(req.body);

    const quote = await createQuote(
      directPrisma,
      req.user.organizationId,
      input,
      {
        id: req.user.id ?? null,
        supabaseUserId: req.user.supabaseUserId,
        role: req.user.role,
        organizationId: req.user.organizationId,
      },
    );

    res.status(201).json({
      success: true,
      data: { quote },
      quote, // backward-compatible alias
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
 * /api/v1/quotes:
 *   get:
 *     summary: List quotations
 *     description: Lists quotes with bi-tenant scoping (hospitals view their RFQs, vendors view received quotation requests).
 *     tags:
 *       - Quotes
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
 *         schema: { type: string, enum: ["DRAFT", "SENT", "ACCEPTED", "DECLINED"] }
 *     responses:
 *       200:
 *         description: Paginated quote list
 */
quotesRouter.get("/", async (req, res, next) => {
  try {
    const query = ListQuotesQuerySchema.parse(req.query);

    const { items, nextCursor, limit } = await listQuotes(
      prisma,
      query,
      req.user,
    );

    res.status(200).json({
      success: true,
      data: { quotes: items },
      quotes: items, // backward-compatible alias
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
 * /api/v1/quotes/{id}:
 *   get:
 *     summary: Get quotation details
 *     description: Retrieves quotation and line items. Access restricted to the purchasing hospital and supplying vendor.
 *     tags:
 *       - Quotes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Quote details
 *       404:
 *         description: Quote not found or unauthorized
 */
quotesRouter.get("/:id", async (req, res, next) => {
  try {
    const { id } = QuoteIdParamSchema.parse(req.params);

    const quote = await getQuoteById(prisma, id, req.user);

    res.status(200).json({
      success: true,
      data: { quote },
      quote, // backward-compatible alias
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
 * /api/v1/quotes/{id}:
 *   patch:
 *     summary: Transition quote status
 *     description: Updates quotation status. Vendors can send (SENT); Hospitals can accept (ACCEPTED) or decline (DECLINED). Accepting a quote automatically creates a purchase Order.
 *     tags:
 *       - Quotes
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
 *               status: { type: string, enum: ["SENT", "ACCEPTED", "DECLINED"] }
 *     responses:
 *       200:
 *         description: Quote status updated (and Order created if ACCEPTED)
 *       400:
 *         description: Invalid state transition
 *       403:
 *         description: Forbidden (Caller not permitted to execute this transition)
 *       404:
 *         description: Quote not found
 */
quotesRouter.patch("/:id", async (req, res, next) => {
  try {
    const { id } = QuoteIdParamSchema.parse(req.params);
    const { status } = UpdateQuoteStatusSchema.parse(req.body);

    const quote = await updateQuoteStatus(
      directPrisma,
      id,
      status,
      {
        id: req.user.id ?? null,
        supabaseUserId: req.user.supabaseUserId,
        role: req.user.role,
        organizationId: req.user.organizationId,
      },
    );

    res.status(200).json({
      success: true,
      data: { quote },
      quote, // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});
