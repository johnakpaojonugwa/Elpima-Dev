import { describe, expect, it } from "vitest";
import {
  CreateQuoteSchema,
  QuoteItemInputSchema,
  UpdateQuoteStatusSchema,
  QuoteIdParamSchema,
  ListQuotesQuerySchema,
} from "./validation.js";

describe("Quotes validation schemas (T4.1)", () => {
  describe("QuoteItemInputSchema", () => {
    it("accepts valid item input", () => {
      const valid = {
        productId: "00000000-0000-4000-8000-000000000001",
        quantity: 5,
      };
      const result = QuoteItemInputSchema.parse(valid);
      expect(result.productId).toBe(valid.productId);
      expect(result.quantity).toBe(5);
    });

    it("rejects non-positive quantity", () => {
      expect(() =>
        QuoteItemInputSchema.parse({
          productId: "00000000-0000-4000-8000-000000000001",
          quantity: 0,
        }),
      ).toThrow();
    });
  });

  describe("CreateQuoteSchema", () => {
    it("accepts a valid quote creation payload", () => {
      const valid = {
        vendorId: "00000000-0000-4000-8000-000000000002",
        items: [
          {
            productId: "00000000-0000-4000-8000-000000000001",
            quantity: 10,
          },
        ],
        notes: "Deliver to surgical ward 3",
      };
      const result = CreateQuoteSchema.parse(valid);
      expect(result.vendorId).toBe(valid.vendorId);
      expect(result.items).toHaveLength(1);
    });

    it("rejects an empty items array", () => {
      expect(() =>
        CreateQuoteSchema.parse({
          vendorId: "00000000-0000-4000-8000-000000000002",
          items: [],
        }),
      ).toThrow();
    });
  });

  describe("UpdateQuoteStatusSchema", () => {
    it("accepts valid status transitions", () => {
      expect(UpdateQuoteStatusSchema.parse({ status: "SENT" }).status).toBe("SENT");
      expect(UpdateQuoteStatusSchema.parse({ status: "ACCEPTED" }).status).toBe("ACCEPTED");
      expect(UpdateQuoteStatusSchema.parse({ status: "DECLINED" }).status).toBe("DECLINED");
    });

    it("rejects invalid status", () => {
      expect(() => UpdateQuoteStatusSchema.parse({ status: "UNKNOWN" })).toThrow();
    });
  });

  describe("QuoteIdParamSchema", () => {
    it("accepts valid UUID", () => {
      const valid = { id: "00000000-0000-4000-8000-000000000001" };
      expect(QuoteIdParamSchema.parse(valid).id).toBe(valid.id);
    });

    it("rejects malformed UUID", () => {
      expect(() => QuoteIdParamSchema.parse({ id: "bad-id" })).toThrow();
    });
  });

  describe("ListQuotesQuerySchema", () => {
    it("defaults limit to 20", () => {
      expect(ListQuotesQuerySchema.parse({}).limit).toBe(20);
    });
  });
});
