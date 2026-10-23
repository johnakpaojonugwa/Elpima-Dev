import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";

describe("Health & Liveness Probes", () => {
  const app = createApp();

  describe("GET /healthz/live & GET /health/live (Shallow Liveness)", () => {
    it("returns 200 OK with status and uptime without querying database", async () => {
      const res = await request(app).get("/healthz/live");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(typeof res.body.uptimeSeconds).toBe("number");
      expect(typeof res.body.timestamp).toBe("string");
    });

    it("serves liveness under /health/live as well", async () => {
      const res = await request(app).get("/health/live");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  describe("GET /healthz/ready & GET /health (Deep Readiness)", () => {
    it("returns 200 OK with dbLatencyMs when database query succeeds", async () => {
      const querySpy = vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }]);

      const res = await request(app).get("/healthz/ready");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(typeof res.body.dbLatencyMs).toBe("number");
      expect(querySpy).toHaveBeenCalled();

      querySpy.mockRestore();
    });

    it("returns 503 Degraded when database query throws", async () => {
      const querySpy = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("Connection refused"));

      const res = await request(app).get("/healthz/ready");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("degraded");
      expect(res.body.error).toBe("Database unreachable");

      querySpy.mockRestore();
    });
  });
});
