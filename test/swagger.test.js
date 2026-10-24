import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("OpenAPI / Swagger Documentation", () => {
  const app = createApp();

  it("serves generated OpenAPI 3.0 specification at /api/v1/docs/openapi.json", async () => {
    const res = await request(app)
      .get("/api/v1/docs/openapi.json")
      .expect(200);

    expect(res.body.openapi).toBe("3.0.0");
    expect(res.body.info.title).toContain("Elpima");

    // Verify key documented paths
    const paths = Object.keys(res.body.paths);
    expect(paths).toContain("/healthz/live");
    expect(paths).toContain("/healthz/ready");
    expect(paths).toContain("/metrics");
    expect(paths).toContain("/auth/me");
    expect(paths).toContain("/api/v1/organizations");
    expect(paths).toContain("/api/v1/organizations/{id}");
    expect(paths).toContain("/api/v1/products");
    expect(paths).toContain("/api/v1/products/{id}");
    expect(paths).toContain("/api/v1/licenses");
    expect(paths).toContain("/api/v1/licenses/{id}");
    expect(paths).toContain("/api/v1/quotes");
    expect(paths).toContain("/api/v1/quotes/{id}");
    expect(paths).toContain("/api/v1/orders");
    expect(paths).toContain("/api/v1/orders/{id}");
  });

  it("serves Swagger UI at /api/v1/docs", async () => {
    const res = await request(app)
      .get("/api/v1/docs/")
    expect(res.text).toContain("Elpima API Documentation");
    expect(res.text).toContain("swagger-ui");
  });
});
