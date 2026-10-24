import { z } from "zod";

// =====================================================================
// Products module — request validation schemas (T2.1)
// =====================================================================

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;
const MAX_SKU = 100;

function optionalText(maxLength) {
  return z
    .string()
    .trim()
    .max(maxLength, `must be ${maxLength} characters or fewer`)
    .optional()
    .transform((fieldValue) => (fieldValue === undefined || fieldValue === "" ? undefined : fieldValue));
}

export const CreateProductSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name is required")
      .max(MAX_NAME, `name must be ${MAX_NAME} characters or fewer`),
    description: optionalText(MAX_DESCRIPTION),
    sku: optionalText(MAX_SKU),
    imageUrl: z
      .string()
      .trim()
      .url("invalid image URL")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    unitPrice: z.coerce
      .number()
      .positive("unitPrice must be greater than 0"),
    currency: z
      .string()
      .trim()
      .min(3, "currency must be 3 characters")
      .max(3, "currency must be 3 characters")
      .default("NGN"),
    inStock: z.boolean().default(true),
    minOrderQty: z.coerce.number().int().min(1, "minOrderQty must be at least 1").default(1),
    categoryId: z
      .string()
      .uuid("categoryId must be a valid UUID")
      .optional()
      .transform((fieldValue) => (fieldValue === "" ? undefined : fieldValue)),
  })
  .strict();

export const UpdateProductSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name is required")
      .max(MAX_NAME, `name must be ${MAX_NAME} characters or fewer`)
      .optional(),
    description: optionalText(MAX_DESCRIPTION),
    sku: optionalText(MAX_SKU),
    imageUrl: z
      .string()
      .trim()
      .url("invalid image URL")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    unitPrice: z.coerce
      .number()
      .positive("unitPrice must be greater than 0")
      .optional(),
    currency: z
      .string()
      .trim()
      .min(3)
      .max(3)
      .optional(),
    inStock: z.boolean().optional(),
    minOrderQty: z.coerce.number().int().min(1).optional(),
    categoryId: z
      .string()
      .uuid("categoryId must be a valid UUID")
      .optional()
      .or(z.literal("").transform(() => undefined))
      .or(z.null()),
  })
  .strict();

export const ProductIdParameterSchema = z
  .object({
    id: z.string().uuid("id must be a valid UUID"),
  })
  .strict();

export const ProductIdParamSchema = ProductIdParameterSchema;

export const ListProductsQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    categoryId: z.string().uuid().optional(),
    vendorId: z.string().uuid().optional(),
    inStock: z
      .enum(["true", "false"])
      .transform((stockStatusString) => stockStatusString === "true")
      .optional(),
    q: z.string().trim().max(100).optional(),
    searchQuery: z.string().trim().max(100).optional(),
  })
  .strict();
