// Integration test suite for Phase 4: Orders & Fulfillment (/api/v1/orders)
//
// Exercises:
//   - T4.5: GET /api/v1/orders (bi-tenant isolation: buyer hospital & seller vendor)
//   - T4.5b: GET /api/v1/orders/:id (participating org 200, non-participating 404, audit log)
//   - T4.6: PATCH /api/v1/orders/:id (vendor confirm & fulfill, state transition validation, audit log)

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

describe.skipIf(skipReason)("Orders & Fulfillment API (/api/v1/orders)", () => {
  let app;
  let platformAdminToken;
  let hospitalOrgA;
  let hospitalOrgB;
  let vendorOrgA;
  let hospitalAToken;
  let hospitalBToken;
  let vendorAToken;
  let activeOrder;

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
        name: `Cedarcrest Hospitals ${Date.now()}`,
        type: "HOSPITAL",
        email: `hosp-a-${Date.now()}@elpima-test.invalid`,
        city: "Apo, Abuja",
      });
    expect(resHospA.status).toBe(201);
    hospitalOrgA = resHospA.body.data.organization;
    createdOrgIds.push(hospitalOrgA.id);

    // 3. Provision Hospital Org B (Unrelated Hospital)
    const resHospB = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Nizamiye Hospital ${Date.now()}`,
        type: "HOSPITAL",
        email: `hosp-b-${Date.now()}@elpima-test.invalid`,
        city: "Idu, Abuja",
      });
    expect(resHospB.status).toBe(201);
    hospitalOrgB = resHospB.body.data.organization;
    createdOrgIds.push(hospitalOrgB.id);

    // 4. Provision Vendor Org A (Seller)
    const resVendorA = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Universal Medical Devices ${Date.now()}`,
        type: "VENDOR",
        email: `vendor-a-${Date.now()}@elpima-test.invalid`,
        city: "Yaba, Lagos",
      });
    expect(resVendorA.status).toBe(201);
    vendorOrgA = resVendorA.body.data.organization;
    createdOrgIds.push(vendorOrgA.id);

    // 5. Sign JWTs
    hospitalAToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-ordhospa0000001",
        organization_id: hospitalOrgA.id,
        organization_type: "HOSPITAL",
        role: "ORG_ADMIN",
        email: "purchasing@cedarcrest.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    hospitalBToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-ordhospb0000001",
        organization_id: hospitalOrgB.id,
        organization_type: "HOSPITAL",
        role: "ORG_ADMIN",
        email: "purchasing@nizamiye.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    vendorAToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-ordvendora000001",
        organization_id: vendorOrgA.id,
        organization_type: "VENDOR",
        role: "ORG_ADMIN",
        email: "sales@universal-med.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    // 6. Create product, quote, send, and accept to produce an active Order
    const prodRes = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${vendorAToken}`)
      .send({
        name: "Pulse Oximeter Fingertip Medical Grade",
        unitPrice: 18500.0,
        currency: "NGN",
      });
    expect(prodRes.status).toBe(201);
    const product = prodRes.body.data.product;
    createdProductIds.push(product.id);

    const quoteRes = await request(app)
      .post("/api/v1/quotes")
      .set("Authorization", `Bearer ${hospitalAToken}`)
      .send({
        vendorId: vendorOrgA.id,
        items: [{ productId: product.id, quantity: 4 }],
      });
    expect(quoteRes.status).toBe(201);
    const quote = quoteRes.body.data.quote;
    createdQuoteIds.push(quote.id);

    // Vendor sends quote
    const sendRes = await request(app)
      .patch(`/api/v1/quotes/${quote.id}`)
      .set("Authorization", `Bearer ${vendorAToken}`)
      .send({ status: "SENT" });
    expect(sendRes.status).toBe(200);

    // Hospital accepts quote -> generates Order!
    const acceptRes = await request(app)
      .patch(`/api/v1/quotes/${quote.id}`)
      .set("Authorization", `Bearer ${hospitalAToken}`)
      .send({ status: "ACCEPTED" });
    expect(acceptRes.status).toBe(200);
    activeOrder = acceptRes.body.data.quote.order;
    expect(activeOrder).toBeDefined();
    createdOrderIds.push(activeOrder.id);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const id of createdOrderIds) {
      try {
        await prisma.order.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete order ${id}: ${err.message}`);
      }
    }

    for (const id of createdQuoteIds) {
      try {
        await prisma.quote.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete quote ${id}: ${err.message}`);
      }
    }

    for (const id of createdProductIds) {
      try {
        await prisma.product.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete product ${id}: ${err.message}`);
      }
    }

    for (const id of createdOrgIds) {
      try {
        await prisma.organization.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete org ${id}: ${err.message}`);
      }
    }
  });

  describe("GET /api/v1/orders (T4.5)", () => {
    it("allows the purchasing hospital to see its orders", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/orders")
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.orders)).toBe(true);
      expect(res.body.data.orders.length).toBeGreaterThanOrEqual(1);
      for (const ord of res.body.data.orders) {
        expect(ord.hospitalId).toBe(hospitalOrgA.id);
      }
    });

    it("allows the supplying vendor to see orders placed with it", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/orders")
        .set("Authorization", `Bearer ${vendorAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orders.length).toBeGreaterThanOrEqual(1);
    });

    it("does not expose Hospital A's orders to Hospital B", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/orders")
        .set("Authorization", `Bearer ${hospitalBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.orders).toHaveLength(0);
    });

    it("allows PLATFORM_ADMIN to view all orders across tenants", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/orders")
        .set("Authorization", `Bearer ${platformAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.orders.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /api/v1/orders/:id (T4.5b)", () => {
    it("allows purchasing hospital to read order details and records audit log", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${activeOrder.id}`)
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.order.id).toBe(activeOrder.id);
      expect(res.body.data.order.hospital.name).toBeDefined();

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "order",
          entityId: activeOrder.id,
          action: "read",
        },
      });
      expect(auditLog).not.toBeNull();
    });

    it("allows supplying vendor to read order details", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${activeOrder.id}`)
        .set("Authorization", `Bearer ${vendorAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.order.id).toBe(activeOrder.id);
    });

    it("rejects unrelated Hospital B with 404 anti-enumeration", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${activeOrder.id}`)
        .set("Authorization", `Bearer ${hospitalBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not found/i);
    });

    it("returns 400 for a malformed UUID param", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/orders/not-a-valid-uuid")
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("PATCH /api/v1/orders/:id (T4.6)", () => {
    it("rejects hospital trying to CONFIRM order with 403 (vendor only)", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .patch(`/api/v1/orders/${activeOrder.id}`)
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .send({ status: "CONFIRMED" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/only the supplying vendor/i);
    });

    it("allows supplying vendor to CONFIRM order (PENDING -> CONFIRMED)", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .patch(`/api/v1/orders/${activeOrder.id}`)
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({ status: "CONFIRMED" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.order.status).toBe("CONFIRMED");
    });

    it("allows supplying vendor to FULFILL confirmed order (CONFIRMED -> FULFILLED)", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .patch(`/api/v1/orders/${activeOrder.id}`)
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({ status: "FULFILLED" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.order.status).toBe("FULFILLED");

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "order",
          entityId: activeOrder.id,
          action: "update_status",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.metadata.newStatus).toBe("FULFILLED");
    });

    it("rejects attempt to CANCEL an already fulfilled order with 400", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .patch(`/api/v1/orders/${activeOrder.id}`)
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .send({ status: "CANCELLED" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/confirmed or fulfilled orders cannot be cancelled/i);
    });
  });
});
