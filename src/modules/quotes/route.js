import { Router } from "express";

import { prisma, directPrisma } from "../../config/prisma.js";
import {
  CreateQuoteSchema,
  UpdateQuoteStatusSchema,
  QuoteIdParameterSchema,
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
import { AppError } from "../../utils/AppError.js";
import {
  formatRfqWhatsAppMessage,
  createWhatsAppChatLink,
} from "../../services/whatsapp.service.js";

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
quotesRouter.post("/", requireOrgType("HOSPITAL"), async (request, response, next) => {
  try {
    const input = CreateQuoteSchema.parse(request.body);

    const quote = await createQuote(
      directPrisma,
      request.user.organizationId,
      input,
      {
        id: request.user.id ?? null,
        supabaseUserId: request.user.supabaseUserId,
        role: request.user.role,
        organizationId: request.user.organizationId,
      },
    );

    response.status(201).json({
      success: true,
      data: { quote },
      quote, // backward-compatible alias
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
quotesRouter.get("/", async (request, response, next) => {
  try {
    const queryParameters = ListQuotesQuerySchema.parse(request.query);

    const { items, nextCursor, limit } = await listQuotes(
      prisma,
      queryParameters,
      request.user,
    );

    response.status(200).json({
      success: true,
      data: { quotes: items },
      quotes: items, // backward-compatible alias
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
quotesRouter.get("/:id", async (request, response, next) => {
  try {
    const { id: quoteId } = QuoteIdParameterSchema.parse(request.params);

    const quote = await getQuoteById(prisma, quoteId, request.user);

    response.status(200).json({
      success: true,
      data: { quote },
      quote, // backward-compatible alias
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
quotesRouter.patch("/:id", async (request, response, next) => {
  try {
    const { id: quoteId } = QuoteIdParameterSchema.parse(request.params);
    const { status } = UpdateQuoteStatusSchema.parse(request.body);

    const quote = await updateQuoteStatus(
      directPrisma,
      quoteId,
      status,
      {
        id: request.user.id ?? null,
        supabaseUserId: request.user.supabaseUserId,
        role: request.user.role,
        organizationId: request.user.organizationId,
      },
    );

    response.status(200).json({
      success: true,
      data: { quote },
      quote, // backward-compatible alias
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
 * /api/v1/quotes/{id}/whatsapp-link:
 *   get:
 *     summary: Generate standard WhatsApp Click-to-Chat alert link
 *     description: Generates a standard universal wa.me deep-link formatted with quote details to notify the vendor or hospital on regular WhatsApp. Updates quote whatsappStatus to SENT.
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
 *         description: WhatsApp deep-link and formatted message generated
 *       404:
 *         description: Quote not found
 */
quotesRouter.get("/:id/whatsapp-link", async (request, response, next) => {
  try {
    const { id: quoteId } = QuoteIdParameterSchema.parse(request.params);

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        hospital: { select: { id: true, name: true, phone: true } },
        vendor: { select: { id: true, name: true, phone: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });

    if (!quote) {
      throw new AppError(404, "Quote not found");
    }

    const isPlatformAdmin = request.user.role === "PLATFORM_ADMIN";
    const isParticipant =
      request.user.organizationId === quote.hospitalId ||
      request.user.organizationId === quote.vendorId;

    if (!isPlatformAdmin && !isParticipant) {
      throw new AppError(404, "Quote not found");
    }

    const isCallerHospital = request.user.organizationId === quote.hospitalId;
    const recipientOrg = isCallerHospital ? quote.vendor : quote.hospital;

    const message = formatRfqWhatsAppMessage({
      quoteId: quote.id,
      hospitalName: quote.hospital.name,
      vendorName: quote.vendor.name,
      itemsCount: quote.items.length,
      totalAmount: quote.totalAmount,
      currency: quote.currency,
      notes: quote.notes,
      items: quote.items.map((quoteItem) => ({
        name: quoteItem.product?.name || "Medical Item",
        quantity: quoteItem.quantity,
      })),
    });

    const whatsappUrl = createWhatsAppChatLink(recipientOrg.phone, message);

    await prisma.quote.update({
      where: { id: quote.id },
      data: {
        whatsappStatus: "SENT",
        whatsappSentAt: new Date(),
      },
    });

    response.status(200).json({
      success: true,
      data: {
        whatsappUrl,
        message,
        recipientPhone: recipientOrg.phone,
        status: "SENT",
      },
      meta: {
        ...(request.correlationId ? { correlationId: request.correlationId } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
});
