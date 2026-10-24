// Integration test suite for Phase 3: Licenses & Hospital Verification (/api/v1/licenses)
//
// Exercises:
//   - T3.2: POST /api/v1/licenses (HOSPITAL 201, VENDOR 403, validation, audit log)
//   - T3.3: GET /api/v1/licenses (tenant isolation, PLATFORM_ADMIN browse, pagination)
//   - T3.3b: GET /api/v1/licenses/:id (owner 200, cross-tenant 404, audit log)
//   - T3.4: PATCH /api/v1/licenses/:id (PLATFORM_ADMIN review, reject reason enforcement, audit log)

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

describe.skipIf(skipReason)("Licenses & Hospital Verification API (/api/v1/licenses)", () => {
  let app;
  let platformAdminToken;
  let hospitalOrgA;
  let hospitalOrgB;
  let vendorOrg;
  let hospitalAToken;
  let hospitalBToken;
  let vendorToken;

  const createdOrgIds = [];
  const createdLicenseIds = [];

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

    // 2. Provision Hospital Org A
    const resHospA = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `Lagos University Teaching Hospital ${Date.now()}`,
        type: "HOSPITAL",
        email: `hosp-a-${Date.now()}@elpima-test.invalid`,
        city: "Idi-Araba, Lagos",
      });
    expect(resHospA.status).toBe(201);
    hospitalOrgA = resHospA.body.data.organization;
    createdOrgIds.push(hospitalOrgA.id);

    // 3. Provision Hospital Org B
    const resHospB = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `National Hospital Abuja ${Date.now()}`,
        type: "HOSPITAL",
        email: `hosp-b-${Date.now()}@elpima-test.invalid`,
        city: "Central District, Abuja",
      });
    expect(resHospB.status).toBe(201);
    hospitalOrgB = resHospB.body.data.organization;
    createdOrgIds.push(hospitalOrgB.id);

    // 4. Provision Vendor Org
    const resVendor = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `BioTech Diagnostics Nigeria ${Date.now()}`,
        type: "VENDOR",
        email: `vendor-${Date.now()}@elpima-test.invalid`,
        city: "Ikeja, Lagos",
      });
    expect(resVendor.status).toBe(201);
    vendorOrg = resVendor.body.data.organization;
    createdOrgIds.push(vendorOrg.id);

    // 5. Sign JWTs
    hospitalAToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-hospa000000001",
        organization_id: hospitalOrgA.id,
        organization_type: "HOSPITAL",
        role: "ORG_ADMIN",
        email: "admin@luth.invalid",
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
        email: "admin@nha.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    vendorToken = jwt.sign(
      {
        sub: "00000000-0000-4000-8000-vendor00000001",
        organization_id: vendorOrg.id,
        organization_type: "VENDOR",
        role: "ORG_ADMIN",
        email: "admin@biotech.invalid",
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const id of createdLicenseIds) {
      try {
        await prisma.license.delete({ where: { id } });
      } catch (err) {
        logger.warn(`cleanup: could not delete license ${id}: ${err.message}`);
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

  describe("POST /api/v1/licenses (T3.2)", () => {
    it("rejects unauthenticated requests with 401", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/licenses")
        .send({
          licenseNumber: "HEFAMAA/2026/0123",
          issuingBody: "HEFAMAA Lagos",
          documentUrl: "https://storage.supabase.co/licenses/hefamaa.pdf",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("rejects VENDOR organizations with 403 Forbidden", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/licenses")
        .set("Authorization", `Bearer ${vendorToken}`)
        .send({
          licenseNumber: "HEFAMAA/2026/0123",
          issuingBody: "HEFAMAA Lagos",
          documentUrl: "https://storage.supabase.co/licenses/hefamaa.pdf",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/organization type/i);
    });

    it("rejects payload with invalid documentUrl with 400", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/licenses")
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .send({
          licenseNumber: "HEFAMAA/2026/0123",
          issuingBody: "HEFAMAA Lagos",
          documentUrl: "not-a-valid-url-format",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.kind).toBe("validation_error");
    });

    it("creates a license in PENDING status for HOSPITAL and records audit log", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .post("/api/v1/licenses")
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .send({
          licenseNumber: `HEFAMAA-${Date.now()}`,
          issuingBody: "Health Facility Monitoring and Accreditation Agency (HEFAMAA)",
          documentUrl: "https://storage.supabase.co/v1/object/authenticated/licenses/cert.pdf",
          expiresAt: "2027-12-31T23:59:59.000Z",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.license).toBeDefined();

      const license = res.body.data.license;
      expect(license.id).toBeDefined();
      expect(license.organizationId).toBe(hospitalOrgA.id);
      expect(license.status).toBe("PENDING");
      expect(license.issuingBody).toContain("HEFAMAA");

      createdLicenseIds.push(license.id);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "license",
          entityId: license.id,
          action: "create",
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.organizationId).toBe(hospitalOrgA.id);
    });
  });

  describe("GET /api/v1/licenses (T3.3)", () => {
    let secondLicense;

    beforeAll(async () => {
      // Create a license for Hospital B
      const res = await request(app)
        .post("/api/v1/licenses")
        .set("Authorization", `Bearer ${hospitalBToken}`)
        .send({
          licenseNumber: `FMOH-NHA-${Date.now()}`,
          issuingBody: "Federal Ministry of Health Nigeria",
          documentUrl: "https://storage.supabase.co/licenses/fmoh.pdf",
        });
      expect(res.status).toBe(201);
      secondLicense = res.body.data.license;
      createdLicenseIds.push(secondLicense.id);
    });

    it("allows a hospital to view ONLY its own licenses", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/licenses")
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.licenses)).toBe(true);
      expect(res.body.data.licenses.length).toBeGreaterThanOrEqual(1);

      // Verify all returned licenses belong to Hospital A
      for (const lic of res.body.data.licenses) {
        expect(lic.organizationId).toBe(hospitalOrgA.id);
      }
    });

    it("rejects attempt by hospital A to list hospital B's licenses with 404", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get(`/api/v1/licenses?organizationId=${hospitalOrgB.id}`)
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not found/i);
    });

    it("allows PLATFORM_ADMIN to view licenses across all hospitals", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/licenses")
        .set("Authorization", `Bearer ${platformAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.licenses.length).toBeGreaterThanOrEqual(2);
    });

    it("supports cursor pagination with limit", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/licenses?limit=1")
        .set("Authorization", `Bearer ${platformAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.licenses).toHaveLength(1);
      expect(res.body.meta.pagination.limit).toBe(1);
    });
  });

  describe("GET /api/v1/licenses/:id (T3.3b)", () => {
    it("allows owning hospital to retrieve license by ID and audits read", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdLicenseIds[0];
      const res = await request(app)
        .get(`/api/v1/licenses/${targetId}`)
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.license.id).toBe(targetId);
      expect(res.body.data.license.organization.name).toBeDefined();

      // Verify read audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "license",
          entityId: targetId,
          action: "read",
        },
      });
      expect(auditLog).not.toBeNull();
    });

    it("rejects cross-tenant read by Hospital B with 404", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdLicenseIds[0]; // Owned by Hospital A
      const res = await request(app)
        .get(`/api/v1/licenses/${targetId}`)
        .set("Authorization", `Bearer ${hospitalBToken}`); // Caller is Hospital B

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/not found/i);
    });

    it("allows PLATFORM_ADMIN to read any hospital license", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdLicenseIds[0];
      const res = await request(app)
        .get(`/api/v1/licenses/${targetId}`)
        .set("Authorization", `Bearer ${platformAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 400 for a malformed UUID param", { timeout: TEST_TIMEOUT }, async () => {
      const res = await request(app)
        .get("/api/v1/licenses/invalid-uuid-format")
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("PATCH /api/v1/licenses/:id (T3.4)", () => {
    it("rejects non-platform-admin callers with 403 Forbidden", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdLicenseIds[0];
      const res = await request(app)
        .patch(`/api/v1/licenses/${targetId}`)
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .send({
          status: "APPROVED",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/insufficient role/i);
    });

    it("rejects REJECTED status if rejectionReason is missing with 400", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdLicenseIds[0];
      const res = await request(app)
        .patch(`/api/v1/licenses/${targetId}`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({
          status: "REJECTED",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.kind).toBe("validation_error");
    });

    it("allows PLATFORM_ADMIN to approve a PENDING license and records audit log", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdLicenseIds[0];
      const res = await request(app)
        .patch(`/api/v1/licenses/${targetId}`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({
          status: "APPROVED",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.license.status).toBe("APPROVED");
      expect(res.body.data.license.reviewedBy).toBeDefined();
      expect(res.body.data.license.reviewedAt).toBeDefined();

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityType: "license",
          entityId: targetId,
          action: "review",
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.metadata.newStatus).toBe("APPROVED");
    });

    it("rejects transition on already-reviewed license with 400", { timeout: TEST_TIMEOUT }, async () => {
      const targetId = createdLicenseIds[0]; // Already APPROVED
      const res = await request(app)
        .patch(`/api/v1/licenses/${targetId}`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({
          status: "APPROVED",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/only PENDING licenses can be reviewed/i);
    });
  });
});
