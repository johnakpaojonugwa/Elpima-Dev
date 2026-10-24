import { z } from "zod";

// =====================================================================
// Orders Zod validation schemas (Phase 4)
// =====================================================================

const uuidSchema = z.string().uuid({ message: "id must be a valid UUID" });

export const OrderIdParameterSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

export const OrderIdParamSchema = OrderIdParameterSchema;

export const ListOrdersQuerySchema = z
  .object({
    cursor: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["PENDING", "CONFIRMED", "FULFILLED", "CANCELLED"]).optional(),
  })
  .strict();

export const UpdateOrderStatusSchema = z
  .object({
    status: z.enum(["CONFIRMED", "FULFILLED", "CANCELLED"], {
      required_error: "status must be CONFIRMED, FULFILLED, or CANCELLED",
    }),
  })
  .strict();
