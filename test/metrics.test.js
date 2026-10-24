import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { register } from "../src/utils/metrics.js";
import { env } from "../src/config/env.js";

describe("Prometheus Metrics (/metrics)", () => {
  const app = createApp();

  beforeEach(() => {
    delete process.env.METRICS_TOKEN;
    env.METRICS_TOKEN = undefined;
  });

  it("returns 200 with Prometheus text exposition format when unauthenticated and no token required", async () => {
    // Generate some HTTP activity
    await request(app).get("/healthz/live").expect(200);

    const res = await request(app)
      .get("/metrics")
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("elpima_http_requests_total");
    expect(res.text).toContain("elpima_http_request_duration_seconds");
  });

  it("enforces METRICS_TOKEN authorization when configured", async () => {
    env.METRICS_TOKEN = "super-secret-prom-token";

    // 1. Missing token returns 401
    const unauthRes = await request(app)
      .get("/metrics")
      .expect(401);

    expect(unauthRes.body.success).toBe(false);
    expect(unauthRes.body.error.kind).toBe("authentication_error");

    // 2. Invalid token returns 401
    await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer wrong-token")
      .expect(401);

    // 3. Valid token returns 200
    const authRes = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer super-secret-prom-token")
      .expect(200);

    expect(authRes.text).toContain("elpima_http_requests_total");
  });
});
