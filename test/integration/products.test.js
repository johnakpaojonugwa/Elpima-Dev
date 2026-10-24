// Integration test suite for Phase 2: Products Catalog (/api/v1/products)
//
// Exercises:
//   - T2.2: POST /api/v1/products (VENDOR 201, HOSPITAL 403, validation, audit log)
//   - T2.3: GET /api/v1/products (cross-tenant browse, cursor pagination, category/q filter)
//   - T2.3b: GET /api/v1/products/:id (200 for existing, 404 for missing, 400 for bad UUID)
//   - T2.4: PATCH /api/v1/products/:id (owner 200, non-owner 404, audit log)
//   - T2.5: DELETE /api/v1/products/:id (owner 200, non-owner 404, audit log)

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

describe.skipIf(skipReason)("Products Catalog API (/api/v1/products)", () => {
  let app;
  let platformAdminToken;
  let vendorOrgA;
  let vendorOrgB;
  let hospitalOrg;
  let vendorAToken;
  let vendorBToken;
  let hospitalToken;
  let testCategory;

  const createdOrgIds = [];
  const createdProductIds = [];
  const createdCategoryIds = [];

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

    // 2. Provision Vendor Org A
    const resVendorA = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Apex Surgical Supplies ${Date.now()}`,
        type: "VENDOR",
        email: `vendor-a-${Date.now()}@elpima-test.invalid`,
        city: "Lagos",
      });
    expect(resVendorA.status).toBe(201);
    vendorOrgA = resVendorA.body.data.organization;
    createdOrgIds.push(vendorOrgA.id);

    // 3. Provision Vendor Org B (competing vendor)
    const resVendorB = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Beta Medical Instruments ${Date.now()}`,
        type: "VENDOR",
        email: `vendor-b-${Date.now()}@elpima-test.invalid`,
        city: "Abuja",
      });
    expect(resVendorB.status).toBe(201);
    vendorOrgB = resVendorB.body.data.organization;
    createdOrgIds.push(vendorOrgB.id);

    // 4. Provision Hospital Org (buyer)
    const resHospital = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Grace Memorial Hospital ${Date.now()}`,
        type: "HOSPITAL",
        email: `hospital-${Date.now()}@elpima-test.invalid`,
        city: "Port Harcourt",
      });
    expect(resHospital.status).toBe(201);
    hospitalOrg = resHospital.body.data.organization;
    createdOrgIds.push(hospitalOrg.id);

    // 5. Create test Category
    testCategory = await prisma.category.create({
      data: {
        name: `Surgical Blades & Scalpels ${Date.now()}`,
      },
    });
    createdCategoryIds.push(testCategory.id);

    // 6. Sign JWTs with organization_type custom claims
    vendorAToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-vendora0000001",
        organization_id: vendorOrgA.id,
        organization_type: "VENDOR",
        role: "ORG_ADMIN",
        email: "admin@apex-surgical.invalid",
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
        email: "admin@beta-med.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    hospitalToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-hospital000001",
        organization_id: hospitalOrg.id,
        organization_type: "HOSPITAL",
        role: "ORG_ADMIN",
        email: "procurement@grace-hospital.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    // Clean up products
    for (const id of createdProductIds) {
      try {
        await prisma.product.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete product ${id}: ${err.message}`);
      }
    }

    // Clean up categories
    for (const id of createdCategoryIds) {
      try {
        await prisma.category.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete category ${id}: ${err.message}`);
      }
    }

    // Clean up organizations
    for (const id of createdOrgIds) {
      try {
        await prisma.organization.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete org ${id}: ${err.message}`);
      }
    }
  });

  describe("POST /api/v1/products (T2.2)", () => {
    it("rejects unauthenticated requests with 401", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/products")
        .send({
          name: "Disposable Scalpel #10",
          unitPrice: 2500.0,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("rejects HOSPITAL organizations with 403 Forbidden", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${hospitalToken}`)
        .send({
          name: "Surgical Gloves Latex Size 7.5",
          unitPrice: 15000.0,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/organization type/i);
    });

    it("rejects payload with negative price with 400", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({
          name: "Sterile Gauze Pad 100pk",
          unitPrice: -500,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.kind).toBe("validation_error");
    });

    it("creates a product for VENDOR and records an audit log row", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({
          name: "Titanium Surgical Scissors 14cm",
          description: "Curved Mayo scissors, medical grade German stainless titanium",
          sku: `APX-SCIS-${Date.now()}`,
          categoryId: testCategory.id,
          unitPrice: 45000.5,
          currency: "NGN",
          inStock: true,
          minOrderQty: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.product).toBeDefined();

      const product = res.body.data.product;
      expect(product.id).toBeDefined();
      expect(product.name).toBe("Titanium Surgical Scissors 14cm");
      expect(product.vendorId).toBe(vendorOrgA.id);
      expect(product.categoryId).toBe(testCategory.id);
      expect(Number(product.unitPrice)).toBe(45000.5);
      expect(product.minOrderQty).toBe(2);

      createdProductIds.push(product.id);

      // Verify audit log creation
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "product",
          entityId: product.id,
          action: "create",
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.organizationId).toBe(vendorOrgA.id);
    });
  });

  describe("GET /api/v1/products (T2.3)", () => {
    let secondProduct;

    beforeAll(async () => {
      // Create a second product under Vendor B for cross-tenant catalog testing
      const res = await request(app)
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${vendorBToken}`)
        .send({
          name: "N95 Surgical Respirator Masks Box of 50",
          sku: `BETA-N95-${Date.now()}`,
          unitPrice: 32000,
          currency: "NGN",
        });
      expect(res.status).toBe(201);
      secondProduct = res.body.data.product;
      createdProductIds.push(secondProduct.id);
    });

    it("allows HOSPITAL users to browse products across all vendors", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/products")
        .set("Authorization", `Bearer ${hospitalToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.products)).toBe(true);
      expect(res.body.data.products.length).toBeGreaterThanOrEqual(2);

      // Verify vendor details are embedded
      const sample = res.body.data.products[0];
      expect(sample.vendor).toBeDefined();
      expect(sample.vendor.name).toBeDefined();
    });

    it("supports filtering by categoryId", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get(`/api/v1/products?categoryId=${testCategory.id}`)
        .set("Authorization", `Bearer ${hospitalToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      for (const prod of res.body.data.products) {
        expect(prod.categoryId).toBe(testCategory.id);
      }
    });

    it("supports search query ?q= matching name or sku", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/products?q=Titanium")
        .set("Authorization", `Bearer ${hospitalToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.products.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.products.some((p) => p.name.includes("Titanium"))).toBe(true);
    });

    it("supports cursor pagination with limit", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/products?limit=1")
        .set("Authorization", `Bearer ${hospitalToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.products).toHaveLength(1);
      expect(res.body.meta.pagination.limit).toBe(1);
      expect(res.body.meta.pagination.nextCursor).toBeDefined();
    });
  });

  describe("GET /api/v1/products/:id (T2.3b)", () => {
    it("returns 200 and product details for a valid product ID", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdProductIds[0];
      const res = await request(app)
        .get(`/api/v1/products/${targetId}`)
        .set("Authorization", `Bearer ${hospitalToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.product.id).toBe(targetId);
      expect(res.body.data.product.vendor.name).toBeDefined();
    });

    it("returns 404 for a non-existent UUID", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/products/00000000-0000-4000-8000-000000000000")
        .set("Authorization", `Bearer ${hospitalToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not found/i);
    });

    it("returns 400 for a malformed UUID param", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/products/not-a-valid-uuid")
        .set("Authorization", `Bearer ${hospitalToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("PATCH /api/v1/products/:id (T2.4)", () => {
    it("allows the owning vendor to update the product and writes an audit log", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdProductIds[0];
      const res = await request(app)
        .patch(`/api/v1/products/${targetId}`)
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({
          unitPrice: 48500.0,
          inStock: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Number(res.body.data.product.unitPrice)).toBe(48500.0);
      expect(res.body.data.product.inStock).toBe(false);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "product",
          entityId: targetId,
          action: "update",
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.organizationId).toBe(vendorOrgA.id);
    });

    it("rejects non-owner vendor with 404 to prevent ID enumeration", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdProductIds[0]; // Owned by Vendor A
      const res = await request(app)
        .patch(`/api/v1/products/${targetId}`)
        .set("Authorization", `Bearer ${vendorBToken}`) // Vendor B caller
        .send({
          unitPrice: 1000.0,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not found/i);
    });
  });

  describe("DELETE /api/v1/products/:id (T2.5)", () => {
    let productToDelete;

    beforeAll(async () => {
      const res = await request(app)
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({
          name: "Disposable Syringes 10ml Box of 100",
          unitPrice: 8500.0,
        });
      expect(res.status).toBe(201);
      productToDelete = res.body.data.product;
    });

    it("rejects delete by non-owner vendor with 404", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .delete(`/api/v1/products/${productToDelete.id}`)
        .set("Authorization", `Bearer ${vendorBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("allows the owning vendor to delete the product and logs audit row", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .delete(`/api/v1/products/${productToDelete.id}`)
        .set("Authorization", `Bearer ${vendorAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Subsequent GET must return 404
      const getRes = await request(app)
        .get(`/api/v1/products/${productToDelete.id}`)
        .set("Authorization", `Bearer ${vendorAToken}`);
      expect(getRes.status).toBe(404);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "product",
          entityId: productToDelete.id,
          action: "delete",
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.organizationId).toBe(vendorOrgA.id);
    });
  });
});
