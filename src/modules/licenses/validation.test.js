import { describe, expect, it } from "vitest";
import {
  CreateLicenseSchema,
  ReviewLicenseSchema,
  LicenseIdParamSchema,
  ListLicensesQuerySchema,
} from "./validation.js";

describe("Licenses validation schemas (T3.1)", () => {
  describe("CreateLicenseSchema", () => {
    it("accepts a valid license payload", () => {
      const valid = {
        licenseNumber: "MDCN/2026/88921",
        issuingBody: "Medical and Dental Council of Nigeria",
        documentUrl: "https://supabase.co/storage/v1/object/authenticated/licenses/doc.pdf",
        expiresAt: "2027-12-31T23:59:59.000Z",
      };

      const result = CreateLicenseSchema.parse(valid);
      expect(result.licenseNumber).toBe(valid.licenseNumber);
      expect(result.issuingBody).toBe(valid.issuingBody);
      expect(result.documentUrl).toBe(valid.documentUrl);
    });

    it("rejects an invalid documentUrl", () => {
      expect(() =>
        CreateLicenseSchema.parse({
          licenseNumber: "MDCN/123",
          issuingBody: "MDCN",
          documentUrl: "not-a-valid-url",
        }),
      ).toThrow();
    });

    it("rejects when required fields are missing", () => {
      expect(() =>
        CreateLicenseSchema.parse({
          licenseNumber: "MDCN/123",
        }),
      ).toThrow();
    });
  });

  describe("ReviewLicenseSchema", () => {
    it("accepts APPROVED status without rejectionReason", () => {
      const result = ReviewLicenseSchema.parse({
        status: "APPROVED",
      });
      expect(result.status).toBe("APPROVED");
    });

    it("accepts REJECTED status with rejectionReason", () => {
      const result = ReviewLicenseSchema.parse({
        status: "REJECTED",
        rejectionReason: "Document expired in 2024. Please upload an active certificate.",
      });
      expect(result.status).toBe("REJECTED");
      expect(result.rejectionReason).toMatch(/expired/);
    });

    it("rejects REJECTED status without rejectionReason", () => {
      expect(() =>
        ReviewLicenseSchema.parse({
          status: "REJECTED",
        }),
      ).toThrow(/rejectionReason is required/i);
    });

    it("rejects invalid status", () => {
      expect(() =>
        ReviewLicenseSchema.parse({
          status: "PENDING",
        }),
      ).toThrow();
    });
  });

  describe("LicenseIdParamSchema", () => {
    it("accepts a valid UUID", () => {
      const valid = { id: "a0000000-0000-4000-8000-000000000001" };
      expect(LicenseIdParamSchema.parse(valid).id).toBe(valid.id);
    });

    it("rejects malformed UUID", () => {
      expect(() => LicenseIdParamSchema.parse({ id: "invalid-uuid" })).toThrow();
    });
  });

  describe("ListLicensesQuerySchema", () => {
    it("applies default limit of 20", () => {
      const result = ListLicensesQuerySchema.parse({});
      expect(result.limit).toBe(20);
    });

    it("parses valid status filter", () => {
      const result = ListLicensesQuerySchema.parse({ status: "APPROVED", limit: "10" });
      expect(result.status).toBe("APPROVED");
      expect(result.limit).toBe(10);
    });
  });
});
