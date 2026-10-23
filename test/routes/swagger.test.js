import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

describe("OpenAPI / Swagger Documentation", () => {
  const app = createApp();

  it("serves raw OpenAPI JSON schema at /api/v1/docs/openapi.json", async () => {
    const res = await request(app).get("/api/v1/docs/openapi.json");

    expect(res.status).toBe(200);
    expect(res.body.openapi || res.body.swagger).toBeDefined();
    expect(res.body.info.title).toBe("Elpima B2B Procurement API");
    expect(res.body.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it("serves Swagger UI at /api/v1/docs", async () => {
    const res = await request(app).get("/api/v1/docs/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
  });
});
