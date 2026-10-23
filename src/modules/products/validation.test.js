import { describe, expect, it } from "vitest";
import {
  CreateProductSchema,
  UpdateProductSchema,
  ProductIdParamSchema,
  ListProductsQuerySchema,
} from "./validation.js";

describe("Products Validation Schemas (T2.1)", () => {
  describe("CreateProductSchema", () => {
    it("accepts a valid product creation payload", () => {
      const input = {
        name: "Surgical Scalpel #10",
        unitPrice: 1500.5,
        sku: "SCALP-10",
        currency: "NGN",
        minOrderQty: 5,
        inStock: true,
      };

      const result = CreateProductSchema.parse(input);
      expect(result.name).toBe("Surgical Scalpel #10");
      expect(result.unitPrice).toBe(1500.5);
      expect(result.currency).toBe("NGN");
      expect(result.minOrderQty).toBe(5);
    });

    it("rejects non-positive unitPrice (zero or negative)", () => {
      expect(() =>
        CreateProductSchema.parse({ name: "Gloves", unitPrice: 0 }),
      ).toThrow();
      expect(() =>
        CreateProductSchema.parse({ name: "Gloves", unitPrice: -50 }),
      ).toThrow();
    });

    it("rejects missing required name", () => {
      expect(() => CreateProductSchema.parse({ unitPrice: 500 })).toThrow();
    });

    it("rejects an invalid categoryId (not UUID)", () => {
      expect(() =>
        CreateProductSchema.parse({
          name: "Gloves",
          unitPrice: 500,
          categoryId: "invalid-id",
        }),
      ).toThrow();
    });

    it("rejects unknown fields (strict)", () => {
      expect(() =>
        CreateProductSchema.parse({
          name: "Gloves",
          unitPrice: 500,
          hackedField: "exploit",
        }),
      ).toThrow();
    });
  });

  describe("UpdateProductSchema", () => {
    it("accepts a partial update", () => {
      const result = UpdateProductSchema.parse({
        unitPrice: 2000,
        inStock: false,
      });

      expect(result.unitPrice).toBe(2000);
      expect(result.inStock).toBe(false);
    });

    it("rejects empty name", () => {
      expect(() => UpdateProductSchema.parse({ name: "   " })).toThrow();
    });
  });

  describe("ProductIdParamSchema", () => {
    it("accepts valid UUID", () => {
      const id = "a0000000-0000-4000-8000-000000000001";
      expect(ProductIdParamSchema.parse({ id })).toEqual({ id });
    });

    it("rejects invalid UUID", () => {
      expect(() => ProductIdParamSchema.parse({ id: "123" })).toThrow();
    });
  });

  describe("ListProductsQuerySchema", () => {
    it("provides defaults for pagination", () => {
      const result = ListProductsQuerySchema.parse({});
      expect(result.limit).toBe(20);
    });

    it("transforms inStock string to boolean", () => {
      const result = ListProductsQuerySchema.parse({ inStock: "true" });
      expect(result.inStock).toBe(true);
    });
  });
});
