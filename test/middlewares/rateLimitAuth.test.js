import express from "express";
import { describe, expect, it } from "vitest";

import { authRateLimit } from "../../src/middlewares/rateLimitAuth.js";

// The rate limiter doesn't call `next()` on the success path — the
// route handler closes the response instead. The cleanest way to
// observe this from a unit test is to drive a real Express app and
// wait for the response to be sent. The mock `res` below implements
// just enough of the http.ServerResponse contract (setHeader,
// getHeader, end) for Express's internals and the rate-limit
// middleware to work end-to-end.

function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.get("/probe", authRateLimit, (req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

function makeReq(app) {
  return {
    app,
    ip: "127.0.0.1",
    method: "GET",
    path: "/probe",
    url: "/probe",
    originalUrl: "/probe",
    headers: {},
    connection: { remoteAddress: "127.0.0.1" },
    socket: { remoteAddress: "127.0.0.1" },
  };
}

function makeRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    headers,
    finished: false,
    headersSent: false,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
      return headers[k.toLowerCase()];
    },
    removeHeader(k) {
      delete headers[k.toLowerCase()];
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    set(k, v) {
      headers[k.toLowerCase()] = v;
      return this;
    },
    get(k) {
      return headers[k.toLowerCase()];
    },
    json(o) {
      this.body = o;
      this.end();
    },
    end() {
      this.finished = true;
    },
  };
  return res;
}

function runOne(app) {
  const req = makeReq(app);
  const res = makeRes();
  return new Promise((resolve) => {
    const finish = () => resolve({ status: res.statusCode, headers: res.headers });
    const origEnd = res.end;
    res.end = (...args) => {
      origEnd.apply(res, args);
      finish();
    };
    app(req, res);
    // Safety net: if neither end() nor next() fires (shouldn't happen,
    // but defense in depth), the test still resolves within 200ms.
    setTimeout(finish, 200);
  });
}

describe("authRateLimit", () => {
  it("returns 200 for the first 30 requests from the same IP", async () => {
    const app = buildApp();
    for (let i = 1; i <= 30; i++) {
      const { status, headers } = await runOne(app);
      expect(status, `request ${i} should be 200`).toBe(200);
      expect(headers["ratelimit-limit"]).toBe("30");
    }
  });

  it("returns 429 with a Retry-After header for the 31st request", async () => {
    const app = buildApp();
    for (let i = 1; i <= 30; i++) {
      await runOne(app);
    }
    const { status, headers } = await runOne(app);
    expect(status).toBe(429);
    expect(headers["retry-after"]).toBeDefined();
  });
});
