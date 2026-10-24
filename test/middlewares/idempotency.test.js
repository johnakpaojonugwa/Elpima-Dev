import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { idempotency, clearIdempotencyCache } from "../../src/middlewares/idempotency.js";

describe("Idempotency Middleware", () => {
  let app;
  let executionCount = 0;

  beforeEach(() => {
    clearIdempotencyCache();
    executionCount = 0;

    app = express();
    app.use(express.json());
    app.use(idempotency);

    app.get("/test", (req, res) => {
      res.json({ ok: true });
    });

    app.post("/test-mutate", (req, res) => {
      executionCount++;
      res.status(201).json({
        success: true,
        data: { count: executionCount, payload: req.body },
      });
    });

    app.post("/test-fail", (req, res) => {
      executionCount++;
      res.status(500).json({ success: false, error: "Database crashed" });
    });

    app.post("/test-slow", async (req, res) => {
      executionCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      res.status(200).json({ done: true });
    });
  });

  it("passes GET requests through without caching or modifying", async () => {
    const res1 = await request(app)
      .get("/test")
      .set("Idempotency-Key", "get-key-1");
    expect(res1.status).toBe(200);
    expect(res1.headers["idempotency-replay"]).toBeUndefined();
  });

  it("executes mutating POST request without Idempotency-Key on every call", async () => {
    const res1 = await request(app).post("/test-mutate").send({ a: 1 });
    const res2 = await request(app).post("/test-mutate").send({ a: 1 });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.data.count).toBe(1);
    expect(res2.body.data.count).toBe(2);
    expect(executionCount).toBe(2);
  });

  it("replays cached response when repeat request uses the same Idempotency-Key", async () => {
    const key = "test-uuid-12345";

    const res1 = await request(app)
      .post("/test-mutate")
      .set("Idempotency-Key", key)
      .send({ orderId: "ord-1" });

    expect(res1.status).toBe(201);
    expect(res1.body.data.count).toBe(1);
    expect(res1.headers["idempotency-replay"]).toBeUndefined();

    // Replay with identical key
    const res2 = await request(app)
      .post("/test-mutate")
      .set("Idempotency-Key", key)
      .send({ orderId: "ord-1" });

    expect(res2.status).toBe(201);
    expect(res2.body.data.count).toBe(1); // Cached value!
    expect(res2.headers["idempotency-replay"]).toBe("true");
    expect(executionCount).toBe(1); // Handler was not executed second time
  });

  it("supports X-Idempotency-Key header synonym", async () => {
    const key = "test-synonym-999";

    const res1 = await request(app)
      .post("/test-mutate")
      .set("X-Idempotency-Key", key)
      .send({ foo: "bar" });

    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post("/test-mutate")
      .set("X-Idempotency-Key", key)
      .send({ foo: "bar" });

    expect(res2.status).toBe(201);
    expect(res2.headers["idempotency-replay"]).toBe("true");
    expect(executionCount).toBe(1);
  });

  it("does not cache 5xx server errors, permitting subsequent retries", async () => {
    const key = "error-retry-key";

    const res1 = await request(app)
      .post("/test-fail")
      .set("Idempotency-Key", key);

    expect(res1.status).toBe(500);
    expect(executionCount).toBe(1);

    // Second call should execute handler again because 5xx is not cached
    const res2 = await request(app)
      .post("/test-fail")
      .set("Idempotency-Key", key);

    expect(res2.status).toBe(500);
    expect(executionCount).toBe(2);
    expect(res2.headers["idempotency-replay"]).toBeUndefined();
  });

  it("returns 409 Conflict when a concurrent request with the same key is in-flight", async () => {
    const key = "concurrent-in-flight-key";

    const req1 = request(app)
      .post("/test-slow")
      .set("Idempotency-Key", key);

    // Immediate second request while req1 is delayed
    const req2 = request(app)
      .post("/test-slow")
      .set("Idempotency-Key", key);

    const [res1, res2] = await Promise.all([req1, req2]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    const successRes = res1.status === 200 ? res1 : res2;

    expect(successRes.status).toBe(200);
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.kind).toBe("idempotency_conflict");
  });
});
