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
 * POST /api/v1/quotes
 *
 * Requests a new quotation / RFQ from a vendor.
 * Computes pricing server-side and writes atomically.
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
 * GET /api/v1/quotes
 *
 * Lists quotes with bi-tenant scoping (hospitals view RFQs, vendors view incoming quotes).
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
 * GET /api/v1/quotes/:id
 *
 * Fetches a single quote by ID with bi-tenant isolation.
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
 * PATCH /api/v1/quotes/:id
 *
 * Updates quote status (SENT, ACCEPTED, DECLINED).
 * When ACCEPTED, automatically provisions corresponding Order record.
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
