import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import { randomUUID } from "node:crypto";

import { env } from "../../src/config/env.js";
import { prisma, connectDb } from "../../src/config/prisma.js";
import { createApp } from "../../src/app.js";

const integrationEnabled = process.env.INTEGRATION_TESTS !== "skip";
const skipReason = integrationEnabled
  ? null
  : "INTEGRATION_TESTS=skip; set INTEGRATION_TESTS=run to exercise";

const TEST_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 60_000;

describe.skipIf(skipReason)("Storage & File Upload API (/api/v1/storage)", { timeout: TEST_TIMEOUT }, () => {
  let app;
  let platformAdminToken;
  let hospitalOrgA;
  let hospitalOrgB;
  let vendorOrg;
  let hospitalAToken;
  let hospitalBToken;
  let vendorToken;

  const createdOrgIds = [];

  beforeAll(async () => {
    app = createApp();
    await connectDb();

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

    const suffix = randomUUID().slice(0, 8);

    // 1. Hospital Org A
    const resHospA = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `LUTH Storage Test A ${suffix}`,
        type: "HOSPITAL",
        email: `hosp-storage-a-${suffix}@elpima-test.invalid`,
        phone: "+2348011112222",
        city: "Idi-Araba, Surulere, Lagos",
      });
    expect(resHospA.status).toBe(201);
    hospitalOrgA = resHospA.body.data.organization;
    createdOrgIds.push(hospitalOrgA.id);

    // 2. Hospital Org B
    const resHospB = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `UCH Storage Test B ${suffix}`,
        type: "HOSPITAL",
        email: `hosp-storage-b-${suffix}@elpima-test.invalid`,
        phone: "+2348033334444",
        city: "Queen Elizabeth II Road, Ibadan",
      });
    expect(resHospB.status).toBe(201);
    hospitalOrgB = resHospB.body.data.organization;
    createdOrgIds.push(hospitalOrgB.id);

    // 3. Vendor Org
    const resVend = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({
        name: `MedSupply Storage Test ${suffix}`,
        type: "VENDOR",
        email: `vendor-storage-${suffix}@elpima-test.invalid`,
        phone: "+2348055556666",
        city: "Ikeja Industrial Estate, Lagos",
      });
    expect(resVend.status).toBe(201);
    vendorOrg = resVend.body.data.organization;
    createdOrgIds.push(vendorOrg.id);

    hospitalAToken = jwt.sign(
      {
        sub: `user-${hospitalOrgA.id}`,
        organization_id: hospitalOrgA.id,
        role: "ORG_ADMIN",
        email: `admin@${hospitalOrgA.email}`,
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    hospitalBToken = jwt.sign(
      {
        sub: `user-${hospitalOrgB.id}`,
        organization_id: hospitalOrgB.id,
        role: "ORG_ADMIN",
        email: `admin@${hospitalOrgB.email}`,
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );

    vendorToken = jwt.sign(
      {
        sub: `user-${vendorOrg.id}`,
        organization_id: vendorOrg.id,
        role: "ORG_ADMIN",
        email: `admin@${vendorOrg.email}`,
      },
      env.SUPABASE_JWT_SECRET,
      { algorithm: "HS256", expiresIn: "15m" },
    );
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
    }
  }, HOOK_TIMEOUT);

  describe("POST /api/v1/storage/licenses", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(app)
        .post("/api/v1/storage/licenses")
        .attach("file", Buffer.from("dummy pdf content"), "license.pdf");

      expect(res.status).toBe(401);
    });

    it("rejects requests without file with 400", async () => {
      const res = await request(app)
        .post("/api/v1/storage/licenses")
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("No file uploaded");
    });

    it("rejects invalid document types (e.g. text/plain) with 400", async () => {
      const res = await request(app)
        .post("/api/v1/storage/licenses")
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .attach("file", Buffer.from("plain text content"), "license.txt");

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Invalid file type");
    });

    it("forbids vendor organizations from uploading hospital licenses (403)", async () => {
      const res = await request(app)
        .post("/api/v1/storage/licenses")
        .set("Authorization", `Bearer ${vendorToken}`)
        .attach("file", Buffer.from("%PDF-1.4 simulated"), "license.pdf");

      expect(res.status).toBe(403);
    });

    it("allows hospitals to upload medical licenses (201)", async () => {
      const res = await request(app)
        .post("/api/v1/storage/licenses")
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .attach("file", Buffer.from("%PDF-1.4 valid medical accreditation"), "accreditation.pdf");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.storagePath).toContain(hospitalOrgA.id);
      expect(res.body.data.bucket).toBe("licenses");
    });
  });

  describe("GET /api/v1/storage/licenses/signed-url", () => {
    let uploadedPath;

    beforeAll(async () => {
      const uploadRes = await request(app)
        .post("/api/v1/storage/licenses")
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .attach("file", Buffer.from("%PDF-1.4 cert"), "cert.pdf");

      uploadedPath = uploadRes.body.data.storagePath;
    });

    it("requires path query parameter (400)", async () => {
      const res = await request(app)
        .get("/api/v1/storage/licenses/signed-url")
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(400);
    });

    it("prevents cross-tenant access to another hospital's document (403)", async () => {
      const res = await request(app)
        .get(`/api/v1/storage/licenses/signed-url?path=${encodeURIComponent(uploadedPath)}`)
        .set("Authorization", `Bearer ${hospitalBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain("permission");
    });

    it("allows owning hospital to retrieve signed URL (200)", async () => {
      const res = await request(app)
        .get(`/api/v1/storage/licenses/signed-url?path=${encodeURIComponent(uploadedPath)}`)
        .set("Authorization", `Bearer ${hospitalAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.signedUrl).toBeDefined();
    });

    it("allows PLATFORM_ADMIN to view any hospital document for compliance audit (200)", async () => {
      const res = await request(app)
        .get(`/api/v1/storage/licenses/signed-url?path=${encodeURIComponent(uploadedPath)}`)
        .set("Authorization", `Bearer ${platformAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.signedUrl).toBeDefined();
    });
  });

  describe("POST /api/v1/storage/products", () => {
    it("forbids hospitals from uploading product catalog images (403)", async () => {
      const res = await request(app)
        .post("/api/v1/storage/products")
        .set("Authorization", `Bearer ${hospitalAToken}`)
        .attach("file", Buffer.from("image buffer"), "surgical_scissors.png");

      expect(res.status).toBe(403);
    });

    it("allows vendors to upload product images (201)", async () => {
      const res = await request(app)
        .post("/api/v1/storage/products")
        .set("Authorization", `Bearer ${vendorToken}`)
        .attach("file", Buffer.from("image buffer"), "surgical_gloves.png");

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.storagePath).toContain(vendorOrg.id);
      expect(res.body.data.imageUrl).toBeDefined();
    });
  });
});
