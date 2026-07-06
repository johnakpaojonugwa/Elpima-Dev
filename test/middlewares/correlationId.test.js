import { describe, expect, it } from "vitest";

import { correlationId } from "../../src/middlewares/correlationId.js";

// The middleware sets req.correlationId, sets the X-Request-Id
// response header, and forwards to next(). These tests cover the
// three branches: missing header (mint UUID), valid client-supplied
// header (echo it), and a header that fails the strict allow-list
// (mint a fresh UUID instead — defends against log injection).

function run(headerValue) {
  const req = { headers: {} };
  if (headerValue !== undefined) {
    req.headers["x-request-id"] = headerValue;
  }
  const headers = {};
  const res = {
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
  };
  const next = vi_fn();
  correlationId(req, res, next);
  return { req, headers, next };
}

// Tiny shim so the helper doesn't pull in vitest at the top — vi.fn
// isn't critical to the assertions, only a "called once" check is.
function vi_fn() {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
  };
  fn.calls = calls;
  return fn;
}

describe("correlationId", () => {
  it("mints a UUID when no X-Request-Id header is sent", () => {
    const { req, headers, next } = run(undefined);
    expect(req.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(headers["x-request-id"]).toBe(req.correlationId);
    expect(next.calls).toHaveLength(1);
  });

  it("echoes a valid X-Request-Id matching the allow-list", () => {
    const incoming = "smoke-test-123";
    const { req, headers, next } = run(incoming);
    expect(req.correlationId).toBe(incoming);
    expect(headers["x-request-id"]).toBe(incoming);
    expect(next.calls).toHaveLength(1);
  });

  it("rejects a header with whitespace and mints a fresh UUID", () => {
    // Log-injection guard: any whitespace in the header means the
    // value could contain a CR/LF that would let a client forge
    // additional log lines.
    const { req, headers } = run("bad value with spaces");
    expect(req.correlationId).not.toBe("bad value with spaces");
    expect(req.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(headers["x-request-id"]).toBe(req.correlationId);
  });

  it("rejects a header with control characters and mints a fresh UUID", () => {
    const { req } = run("evil\r\nFAKE LOG ENTRY");
    expect(req.correlationId).not.toContain("\n");
    expect(req.correlationId).not.toContain("\r");
  });

  it("rejects an oversize header and mints a fresh UUID", () => {
    const tooLong = "a".repeat(129);
    const { req, headers } = run(tooLong);
    expect(req.correlationId).not.toBe(tooLong);
    expect(headers["x-request-id"]).toBe(req.correlationId);
  });

  it("accepts the boundary value at exactly 128 chars", () => {
    const justRight = "a".repeat(128);
    const { req } = run(justRight);
    expect(req.correlationId).toBe(justRight);
  });
});
