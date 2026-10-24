import { z } from "zod";

// =====================================================================
// Quotes Zod validation schemas (Phase 4)
// =====================================================================

const uuidSchema = z.string().uuid({ message: "id must be a valid UUID" });

export const QuoteItemInputSchema = z
  .object({
    productId: uuidSchema,
    quantity: z.coerce
      .number({ required_error: "quantity is required" })
      .int({ message: "quantity must be an integer" })
      .positive({ message: "quantity must be greater than 0" }),
  })
  .strict();

export const CreateQuoteSchema = z
  .object({
    vendorId: uuidSchema,
    items: z
      .array(QuoteItemInputSchema, { required_error: "items array is required" })
      .min(1, { message: "Quote must contain at least 1 item" }),
    notes: z.string().trim().max(1000).optional().nullable(),
    expiresAt: z
      .string()
      .datetime({ message: "expiresAt must be a valid ISO datetime string" })
      .optional()
      .nullable(),
  })
  .strict();

export const UpdateQuoteStatusSchema = z
  .object({
    status: z.enum(["SENT", "ACCEPTED", "DECLINED"], {
      required_error: "status must be SENT, ACCEPTED, or DECLINED",
    }),
  })
  .strict();

export const QuoteIdParameterSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

export const QuoteIdParamSchema = QuoteIdParameterSchema;

export const ListQuotesQuerySchema = z
  .object({
    cursor: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["DRAFT", "SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"]).optional(),
    vendorId: uuidSchema.optional(),
    hospitalId: uuidSchema.optional(),
  })
  .strict();
