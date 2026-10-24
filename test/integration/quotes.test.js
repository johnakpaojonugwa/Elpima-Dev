// Integration test suite for Phase 4: Quotes & Procurement RFQ (/api/v1/quotes)
//
// Exercises:
//   - T4.2: POST /api/v1/quotes (HOSPITAL 201, VENDOR 403, server-side pricing, audit log)
//   - T4.3: GET /api/v1/quotes (bi-tenant isolation: buyer & seller only, cursor pagination)
//   - T4.3b: GET /api/v1/quotes/:id (participating org 200, non-participating 404, audit log)
//   - T4.4: PATCH /api/v1/quotes/:id (vendor send, hospital accept, automatic order creation)

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";

import { env } from "../../src/config/env.js";
import { prisma, connectDb } from "../../src/config/prisma.js";
import { createApp } from "../../src/app.js";
import { logger } from "../../src/utils/logger.js";

const integrationEnabled = process.env.INTEGRATION_TESTS !== "skip";
const skipReason = integrationEnabled
  ? null
  : "INTEGRATION_TESTS=skip; set INTEGRATION_TESTS=run to exercise";

const TEST_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 60_000;

describe.skipIf(skipReason)("Quotes & Procurement RFQ API (/api/v1/quotes)", () => {
  let app;
  let platformAdminToken;
  let hospitalOrgA;
  let hospitalOrgB;
  let vendorOrgA;
  let vendorOrgB;
  let hospitalAToken;
  let hospitalBToken;
  let vendorAToken;
  let vendorBToken;
  let productA1;
  let productA2;
  let productB1;

  const createdOrgIds = [];
  const createdProductIds = [];
  const createdQuoteIds = [];
  const createdOrderIds = [];

  beforeAll(async () => {
    app = createApp();
    await connectDb();

    // 1. Platform Admin Token
    platformAdminToken = jwt.sign(
      {
        sub: "00000000-0000-0000-0000-platformadmin0",
        organization_id: "00000000-0000-0000-0000-platformadmin0",
        role: "PLATFORM_ADMIN",
        email: "platform-admin@elpima-test.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    // 2. Provision Hospital Org A (Buyer)
    const resHospA = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Reddington Hospital Victoria Island ${Date.now()}`,
        type: "HOSPITAL",
        email: `hosp-a-${Date.now()}@elpima-test.invalid`,
        city: "Victoria Island, Lagos",
      });
    expect(resHospA.status).toBe(201);
    hospitalOrgA = resHospA.body.data.organization;
    createdOrgIds.push(hospitalOrgA.id);

    // 3. Provision Hospital Org B (Unrelated Hospital)
    const resHospB = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `St. Nicholas Hospital ${Date.now()}`,
        type: "HOSPITAL",
        email: `hosp-b-${Date.now()}@elpima-test.invalid`,
        city: "Lagos Island, Lagos",
      });
    expect(resHospB.status).toBe(201);
    hospitalOrgB = resHospB.body.data.organization;
    createdOrgIds.push(hospitalOrgB.id);

    // 4. Provision Vendor Org A (Seller)
    const resVendorA = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `MedEquip International West Africa ${Date.now()}`,
        type: "VENDOR",
        email: `vendor-a-${Date.now()}@elpima-test.invalid`,
        city: "Ikeja, Lagos",
      });
    expect(resVendorA.status).toBe(201);
    vendorOrgA = resVendorA.body.data.organization;
    createdOrgIds.push(vendorOrgA.id);

    // 5. Provision Vendor Org B (Competing Vendor)
    const resVendorB = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Global Surgical Solutions ${Date.now()}`,
        type: "VENDOR",
        email: `vendor-b-${Date.now()}@elpima-test.invalid`,
        city: "Abuja",
      });
    expect(resVendorB.status).toBe(201);
    vendorOrgB = resVendorB.body.data.organization;
    createdOrgIds.push(vendorOrgB.id);

    // 6. Sign JWTs
    hospitalAToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-hospa000000001",
        organization_id: hospitalOrgA.id,
        organization_type: "HOSPITAL",
        role: "ORG_ADMIN",
        email: "procurement@reddington.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    hospitalBToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-hospb000000001",
        organization_id: hospitalOrgB.id,
        organization_type: "HOSPITAL",
        role: "ORG_ADMIN",
        email: "procurement@stnicholas.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    vendorAToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-vendora0000001",
        organization_id: vendorOrgA.id,
        organization_type: "VENDOR",
        role: "ORG_ADMIN",
        email: "sales@medequip.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    vendorBToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-vendorb0000001",
        organization_id: vendorOrgB.id,
        organization_type: "VENDOR",
        role: "ORG_ADMIN",
        email: "sales@globalsurgical.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    // 7. Seed Catalog Products
    const prodRes1 = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${vendorAToken}`)
      .send({
        name: "Laparoscopic Trocar 10mm Box of 5",
        unitPrice: 35000.0,
        currency: "NGN",
        minOrderQty: 1,
      });
    expect(prodRes1.status).toBe(201);
    productA1 = prodRes1.body.data.product;
    createdProductIds.push(productA1.id);

    const prodRes2 = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${vendorAToken}`)
      .send({
        name: "Endotracheal Tube Size 7.5 Box of 10",
        unitPrice: 12000.0,
        currency: "NGN",
        minOrderQty: 2,
      });
    expect(prodRes2.status).toBe(201);
    productA2 = prodRes2.body.data.product;
    createdProductIds.push(productA2.id);

    const prodResB = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${vendorBToken}`)
      .send({
        name: "Electrosurgical Pencil with Blade",
        unitPrice: 8500.0,
        currency: "NGN",
      });
    expect(prodResB.status).toBe(201);
    productB1 = prodResB.body.data.product;
    createdProductIds.push(productB1.id);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    // 1. Clean up orders
    for (const id of createdOrderIds) {
      try {
        await prisma.order.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete order ${id}: ${err.message}`);
      }
    }

    // 2. Clean up quotes
    for (const id of createdQuoteIds) {
      try {
        await prisma.quote.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete quote ${id}: ${err.message}`);
      }
    }

    // 3. Clean up products
    for (const id of createdProductIds) {
      try {
        await prisma.product.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete product ${id}: ${err.message}`);
      }
    }

    // 4. Clean up orgs
    for (const id of createdOrgIds) {
      try {
        await prisma.organization.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete org ${id}: ${err.message}`);
      }
    }
  });

  describe("POST /api/v1/quotes (T4.2)", () => {
    it("rejects unauthenticated requests with 401", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/quotes")
        .send({
          vendorId: vendorOrgA.id,
          items: [{ productId: productA1.id, quantity: 2 }],
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("rejects VENDOR organizations with 403 Forbidden", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/quotes")
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({
          vendorId: vendorOrgB.id,
          items: [{ productId: productB1.id, quantity: 1 }],
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/organization type/i);
    });

    it("rejects quote requesting products that belong to another vendor with 400", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/quotes")
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .send({
          vendorId: vendorOrgA.id,
          items: [
            { productId: productA1.id, quantity: 2 },
            { productId: productB1.id, quantity: 1 }, // Owned by Vendor B!
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/does not belong to the specified vendor/i);
    });

    it("creates a quote in DRAFT status with server-computed prices and total", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/quotes")
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .send({
          vendorId: vendorOrgA.id,
          items: [
            { productId: productA1.id, quantity: 2 }, // 35000 * 2 = 70000
            { productId: productA2.id, quantity: 3 }, // 12000 * 3 = 36000
          ],
          notes: "Emergency theater restocking request",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quote).toBeDefined();

      const quote = res.body.data.quote;
      expect(quote.id).toBeDefined();
      expect(quote.hospitalId).toBe(hospitalOrgA.id);
      expect(quote.vendorId).toBe(vendorOrgA.id);
      expect(quote.status).toBe("DRAFT");

      // Verify server-side pricing: 70000 + 36000 = 106000
      expect(Number(quote.totalAmount)).toBe(106000);
      expect(quote.items).toHaveLength(2);

      createdQuoteIds.push(quote.id);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "quote",
          entityId: quote.id,
          action: "create",
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.organizationId).toBe(hospitalOrgA.id);
    });
  });

  describe("GET /api/v1/quotes (T4.3)", () => {
    it("allows the purchasing hospital to see its own quotes", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/quotes")
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.quotes)).toBe(true);
      expect(res.body.data.quotes.length).toBeGreaterThanOrEqual(1);
      for (const q of res.body.data.quotes) {
        expect(q.hospitalId).toBe(hospitalOrgA.id);
      }
    });

    it("allows the seller vendor to see quotes addressed to them", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/quotes")
        .set("Authorization", `Bearer ${vendorAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quotes.length).toBeGreaterThanOrEqual(1);
      for (const q of res.body.data.quotes) {
        expect(q.vendorId).toBe(vendorOrgA.id);
      }
    });

    it("does not expose Hospital A's quotes to Hospital B", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/quotes")
        .set("Authorization", `Bearer ${hospitalBToken}`);

      expect(res.status).toBe(200);
      // Hospital B has created 0 quotes
      expect(res.body.data.quotes).toHaveLength(0);
    });

    it("allows PLATFORM_ADMIN to view all quotes across tenants", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/quotes")
        .set("Authorization", `Bearer ${platformAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.quotes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /api/v1/quotes/:id (T4.3b)", () => {
    it("allows participating hospital to read quote and writes audit log", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdQuoteIds[0];
      const res = await request(app)
        .get(`/api/v1/quotes/${targetId}`)
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quote.id).toBe(targetId);
      expect(res.body.data.quote.vendor.name).toBeDefined();

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "quote",
          entityId: targetId,
          action: "read",
        },
      });
      expect(auditLog).not.toBeNull();
    });

    it("allows participating vendor to read quote", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdQuoteIds[0];
      const res = await request(app)
        .get(`/api/v1/quotes/${targetId}`)
        .set("Authorization", `Bearer ${vendorAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.quote.id).toBe(targetId);
    });

    it("rejects non-participating hospital with 404 anti-enumeration", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdQuoteIds[0];
      const res = await request(app)
        .get(`/api/v1/quotes/${targetId}`)
        .set("Authorization", `Bearer ${hospitalBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not found/i);
    });
  });

  describe("PATCH /api/v1/quotes/:id (T4.4)", () => {
    it("rejects hospital trying to transition quote to SENT with 403 (vendor only)", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdQuoteIds[0];
      const res = await request(app)
        .patch(`/api/v1/quotes/${targetId}`)
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .send({ status: "SENT" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/only the vendor can send a quote/i);
    });

    it("allows participating vendor to send quote (DRAFT -> SENT)", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdQuoteIds[0];
      const res = await request(app)
        .patch(`/api/v1/quotes/${targetId}`)
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({ status: "SENT" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quote.status).toBe("SENT");
    });

    it("rejects vendor trying to ACCEPT the quote with 403 (buyer hospital only)", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdQuoteIds[0];
      const res = await request(app)
        .patch(`/api/v1/quotes/${targetId}`)
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({ status: "ACCEPTED" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/only the purchasing hospital can accept/i);
    });

    it("allows purchasing hospital to ACCEPT the quote, generating an Order atomically", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdQuoteIds[0];
      const res = await request(app)
        .patch(`/api/v1/quotes/${targetId}`)
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .send({ status: "ACCEPTED" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quote.status).toBe("ACCEPTED");

      // Verify that Order was automatically generated
      expect(res.body.data.quote.order).toBeDefined();
      const order = res.body.data.quote.order;
      expect(order.id).toBeDefined();
      expect(order.quoteId).toBe(targetId);
      expect(order.hospitalId).toBe(hospitalOrgA.id);
      expect(Number(order.totalAmount)).toBe(106000);
      expect(order.status).toBe("PENDING");

      createdOrderIds.push(order.id);

      // Verify order in database
      const dbOrder = await prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true },
      });
      expect(dbOrder).not.toBeNull();
      expect(dbOrder.items).toHaveLength(2);

      // Verify audit log for transition and order creation
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "quote",
          entityId: targetId,
          action: "update_status",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.metadata.newStatus).toBe("ACCEPTED");
      expect(auditLog.metadata.createdOrderId).toBe(order.id);
    });
  });
});
