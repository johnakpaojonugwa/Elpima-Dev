import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  formatRfqWhatsAppMessage,
  formatOrderConfirmedWhatsAppMessage,
  createWhatsAppChatLink,
} from "./whatsapp.service.js";

describe("WhatsApp Service (Standard WhatsApp)", () => {
  describe("normalizePhone", () => {
    it("converts 11-digit local Nigerian numbers to international 234 format", () => {
      expect(normalizePhone("08012345678")).toBe("2348012345678");
      expect(normalizePhone("07030001122")).toBe("2347030001122");
    });

    it("strips spaces, dashes, and plus signs", () => {
      expect(normalizePhone("+234 801-234-5678")).toBe("2348012345678");
      expect(normalizePhone("+1 (555) 234-5678")).toBe("15552345678");
    });

    it("handles empty or null values gracefully", () => {
      expect(normalizePhone("")).toBe("");
      expect(normalizePhone(null)).toBe("");
    });
  });

  describe("formatRfqWhatsAppMessage", () => {
    it("formats an RFQ message with quote details and item highlights", () => {
      const msg = formatRfqWhatsAppMessage({
        quoteId: "a1b2c3d4-e5f6-7890-abcd-112233445566",
        hospitalName: "Lagoon Hospital",
        vendorName: "MedEquip Supplies",
        itemsCount: 2,
        totalAmount: 150000,
        currency: "NGN",
        items: [
          { name: "Surgical Gloves", quantity: 50 },
          { name: "Disposable Scalpels", quantity: 20 },
        ],
      });

      expect(msg).toContain("Lagoon Hospital");
      expect(msg).toContain("MedEquip Supplies");
      expect(msg).toContain("#a1b2c3d4");
      expect(msg).toContain("NGN 150,000");
      expect(msg).toContain("50x Surgical Gloves");
    });
  });

  describe("createWhatsAppChatLink", () => {
    it("creates standard wa.me deep link with pre-encoded message text", () => {
      const link = createWhatsAppChatLink("08012345678", "Hello from Elpima");
      expect(link).toBe("https://wa.me/2348012345678?text=Hello%20from%20Elpima");
    });

    it("creates universal wa.me link without phone when phone is not provided", () => {
      const link = createWhatsAppChatLink("", "Share this quote");
      expect(link).toBe("https://wa.me/?text=Share%20this%20quote");
    });
  });
});
