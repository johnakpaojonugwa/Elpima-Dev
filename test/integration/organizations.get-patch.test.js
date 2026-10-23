// Integration test for GET and PATCH /api/v1/organizations/:id (T1.3 & T1.4).
//
// Runs against the live Supabase project (skipped if INTEGRATION_TESTS=skip).
// Exercises:
//   - GET own org (200)
//   - GET cross-tenant org (404)
//   - GET as PLATFORM_ADMIN (200 across tenants)
//   - PATCH own org as ORG_ADMIN (200)
//   - PATCH cross-tenant org as ORG_ADMIN (404)
//   - PATCH as ORG_STAFF (403)
//   - PATCH duplicate email (409)
//   - Audit log verification for both read and update

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

describe.skipIf(skipReason)("GET & PATCH /api/v1/organizations/:id", () => {
  let app;
  let platformAdminToken;
  let orgA;
  let orgB;
  let orgAAdminToken;
  let orgAStaffToken;
  let orgBAdminToken;

  const createdOrgIds = [];

  beforeAll(async () => {
    app = createApp();
    await connectDb();

    // 1. Sign synthetic PLATFORM_ADMIN token
    platformAdminToken = jwt.sign(
      {
        sub: "00000000-0000-0000-0000-platformadmin0",
        organization_id: "00000000-0000-0000-0000-platformadmin0",
        role: "PLATFORM_ADMIN",
        email: "platform-admin@elpima-test.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "10m" },
    );

    // 2. Create Tenant A
    const resA = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Hospital Alpha ${Date.now()}`,
        type: "HOSPITAL",
        email: `hospital-a-${Date.now()}@elpima-test.invalid`,
        city: "Lagos",
      });
    expect(resA.status).toBe(201);
    orgA = resA.body.data.organization;
    createdOrgIds.push(orgA.id);

    // 3. Create Tenant B
    const resB = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Vendor Beta ${Date.now()}`,
        type: "VENDOR",
        email: `vendor-b-${Date.now()}@elpima-test.invalid`,
        city: "Abuja",
      });
    expect(resB.status).toBe(201);
    orgB = resB.body.data.organization;
    createdOrgIds.push(orgB.id);

    // 4. Sign tenant-scoped tokens
    orgAAdminToken = jwt.sign(
      {
        sub: "00000000-0000-0000-0000-useralpha0001",
        organization_id: orgA.id,
        role: "ORG_ADMIN",
        email: "admin-a@elpima-test.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "10m" },
    );

    orgAStaffToken = jwt.sign(
      {
        sub: "00000000-0000-0000-0000-useralpha0002",
        organization_id: orgA.id,
        role: "ORG_STAFF",
        email: "staff-a@elpima-test.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "10m" },
    );

    orgBAdminToken = jwt.sign(
      {
        sub: "00000000-0000-0000-0000-userbeta00001",
        organization_id: orgB.id,
        role: "ORG_ADMIN",
        email: "admin-b@elpima-test.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "10m" },
    );
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const id of createdOrgIds) {
      try {
        await prisma.organization.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete org ${id}: ${err.message}`);
      }
    }
  });

  describe("GET /api/v1/organizations/:id (T1.3)", () => {
    it("returns 200 and own organization details for an ORG_STAFF member", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgA.id}`)
        .set("Authorization", `Bearer ${orgAStaffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organization.id).toBe(orgA.id);
      expect(res.body.data.organization.name).toBe(orgA.name);

      // Verify audit log has 'read' action recorded
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: "read",
          entityType: "organization",
          entityId: orgA.id,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(auditLog).toBeTruthy();
    });

    it("returns 404 when tenant A tries to read tenant B's organization (cross-tenant isolation)", async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgB.id}`)
        .set("Authorization", `Bearer ${orgAAdminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe("Organization not found");
    });

    it("allows PLATFORM_ADMIN to read any tenant organization", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${orgB.id}`)
        .set("Authorization", `Bearer ${platformAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.organization.id).toBe(orgB.id);
    });

    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).get(`/api/v1/organizations/${orgA.id}`);
      expect(res.status).toBe(401);
    });

    it("returns 400 when ID is not a valid UUID", async () => {
      const res = await request(app)
        .get("/api/v1/organizations/not-a-uuid")
        .set("Authorization", `Bearer ${platformAdminToken}`);

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/v1/organizations/:id (T1.4)", () => {
    it("allows ORG_ADMIN to update own organization profile", { timeout: TEST_TIMEOUT }, async () => {
      const newPhone = "+2348011223344";
      const newCity = "Port Harcourt";

      const res = await request(app)
        .patch(`/api/v1/organizations/${orgA.id}`)
        .set("Authorization", `Bearer ${orgAAdminToken}`)
        .send({
          phone: newPhone,
          city: newCity,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organization.phone).toBe(newPhone);
      expect(res.body.data.organization.city).toBe(newCity);

      // Verify audit log has 'update' action recorded
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: "update",
          entityType: "organization",
          entityId: orgA.id,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(auditLog).toBeTruthy();
    });

    it("returns 404 when ORG_ADMIN attempts to update another tenant's organization", async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgB.id}`)
        .set("Authorization", `Bearer ${orgAAdminToken}`)
        .send({ city: "Malicious City" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 403 when ORG_STAFF attempts to update own organization", async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgA.id}`)
        .set("Authorization", `Bearer ${orgAStaffToken}`)
        .send({ phone: "+2348000000000" });

      expect(res.status).toBe(403);
    });

    it("rejects attempt to alter immutable field 'type' via update", async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgA.id}`)
        .set("Authorization", `Bearer ${orgAAdminToken}`)
        .send({ type: "VENDOR" });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe("Invalid request payload");
    });

    it("returns 409 Conflict when updating email to an existing organization's email", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .patch(`/api/v1/organizations/${orgA.id}`)
        .set("Authorization", `Bearer ${orgAAdminToken}`)
        .send({ email: orgB.email });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe("An organization with that email already exists");
    });
  });
});
