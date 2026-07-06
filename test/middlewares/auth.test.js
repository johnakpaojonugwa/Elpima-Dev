import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

import { env } from "../../src/config/env.js";
import { AppError } from "../../src/utils/AppError.js";
import {
  requireAuth,
  requireOrgType,
  requireRole,
  verifySupabaseJwt,
} from "../../src/middlewares/auth.js";

// =============================================================================
// verifySupabaseJwt — pure JWT verification
// =============================================================================

describe("verifySupabaseJwt", () => {
  // Stable test secret; SUPABASE_JWT_SECRET is seeded by test/setup.js
  // when not set in the environment.
  const secret = env.SUPABASE_JWT_SECRET;

  it("returns the decoded payload for a valid HS256 token", () => {
    const token = jwt.sign(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        role: "ORG_ADMIN",
        email: "test@example.com",
      },
      secret,
      { algorithm: "HS256", expiresIn: "1h" },
    );

    const payload = verifySupabaseJwt(token, secret);

    expect(payload.sub).toBe("auth-user-uuid");
    expect(payload.organization_id).toBe("org-uuid");
    expect(payload.role).toBe("ORG_ADMIN");
  });

  it("rejects a token signed with a different secret", () => {
    const token = jwt.sign({ sub: "x" }, "wrong-secret", {
      algorithm: "HS256",
      expiresIn: "1h",
    });

    expect(() => verifySupabaseJwt(token, secret)).toThrow(
      jwt.JsonWebTokenError,
    );
  });

  it("rejects an expired token with TokenExpiredError", () => {
    const token = jwt.sign(
      { sub: "x" },
      secret,
      { algorithm: "HS256", expiresIn: -1 }, // already expired
    );

    expect(() => verifySupabaseJwt(token, secret)).toThrow(
      jwt.TokenExpiredError,
    );
  });

  it("rejects a token that claims alg: none (algorithm pinning)", async () => {
    // Hand-craft an unsigned token. `jsonwebtoken`'s `sign` refuses
    // alg: none, so we build the wire format ourselves:
    //   base64url(header).base64url(payload).<empty signature>
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "attacker",
        organization_id: "org-uuid",
        role: "PLATFORM_ADMIN",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    const forgedToken = `${header}.${payload}.`;

    // jsonwebtoken throws its generic JsonWebTokenError for the
    // alg: none case; the name-based classification in
    // errorHandler.js handles it. We don't pin the specific
    // subclass because it varies across versions.
    expect(() => verifySupabaseJwt(forgedToken, secret)).toThrow();
  });
});

// =============================================================================
// requireAuth — bearer token extraction and req.user population
// =============================================================================

describe("requireAuth", () => {
  // Minimal Express stand-ins. We don't need the full req/res contract,
  // just enough to call the middleware and capture the next() callback.
  function mockReqRes(headers = {}) {
    const req = { headers };
    const res = {};
    const next = vi.fn();
    return { req, res, next };
  }

  const secret = env.SUPABASE_JWT_SECRET;

  it("calls next with a 401 AppError when no Authorization header is present", () => {
    const { req, res, next } = mockReqRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
  });

  it("calls next with a 401 AppError when the header is malformed", () => {
    const { req, res, next } = mockReqRes({
      authorization: "NotBearer abc",
    });

    requireAuth(req, res, next);

    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect(next.mock.calls[0][0].status).toBe(401);
  });

  it("populates req.user and calls next() with no error for a valid token", () => {
    const token = jwt.sign(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        role: "ORG_STAFF",
        email: "staff@example.com",
      },
      secret,
      { algorithm: "HS256", expiresIn: "1h" },
    );
    const { req, res, next } = mockReqRes({
      authorization: `Bearer ${token}`,
    });

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith(); // no error
    expect(req.user).toEqual({
      supabaseUserId: "auth-user-uuid",
      organizationId: "org-uuid",
      role: "ORG_STAFF",
      email: "staff@example.com",
    });
  });

  it("rejects a token that lacks the organization_id custom claim", () => {
    // A Supabase access token without organization_id means the
    // custom access token hook hasn't run, or the token predates
    // the hook. Either way, RLS would not see a tenant and the
    // request would silently match zero rows — fail closed.
    const token = jwt.sign(
      { sub: "auth-user-uuid", role: "ORG_STAFF" },
      secret,
      { algorithm: "HS256", expiresIn: "1h" },
    );
    const { req, res, next } = mockReqRes({
      authorization: `Bearer ${token}`,
    });

    requireAuth(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
  });
});

// =============================================================================
// requireRole — user.role gate
// =============================================================================

describe("requireRole", () => {
  function mockReqRes(user) {
    return {
      req: { user },
      res: {},
      next: vi.fn(),
    };
  }

  it("lets a request through when the role is in the allow-list", () => {
    const { req, res, next } = mockReqRes({ role: "ORG_ADMIN" });
    const middleware = requireRole("ORG_ADMIN", "PLATFORM_ADMIN");

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("rejects with 403 when the role is not in the allow-list", () => {
    const { req, res, next } = mockReqRes({ role: "ORG_STAFF" });
    const middleware = requireRole("ORG_ADMIN", "PLATFORM_ADMIN");

    middleware(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(403);
  });

  it("fails closed with 401 when there is no req.user", () => {
    // requireRole is only meaningful after requireAuth; a request
    // that reaches it without req.user is a misconfigured route,
    // not a permission denial. 401 (re-auth) is more accurate than
    // 403 (you can't, even with the right role).
    const { req, res, next } = mockReqRes(undefined);
    const middleware = requireRole("ORG_ADMIN");

    middleware(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
  });
});

// =============================================================================
// requireOrgType — organization.type gate (DB lookup)
// =============================================================================
//
// This is the only test that touches Prisma. We stub the prisma
// module so the middleware sees a deterministic organization record
// without needing a real database connection.

describe("requireOrgType", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lets a request through when the org's type is in the allow-list", async () => {
    const findUnique = vi.fn().mockResolvedValue({ type: "HOSPITAL" });
    vi.doMock("../../src/config/prisma.js", () => ({
      prisma: { organization: { findUnique } },
    }));

    // Re-import after mocking so the middleware sees the stub.
    const { requireOrgType: requireOrgTypeMocked } = await import(
      "../../src/middlewares/auth.js"
    );

    const req = { user: { organizationId: "org-uuid" } };
    const res = {};
    const next = vi.fn();

    await requireOrgTypeMocked("HOSPITAL", "VENDOR")(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "org-uuid" },
      select: { type: true },
    });
  });

  it("rejects with 403 when the org's type is not in the allow-list", async () => {
    vi.doMock("../../src/config/prisma.js", () => ({
      prisma: {
        organization: {
          findUnique: vi.fn().mockResolvedValue({ type: "VENDOR" }),
        },
      },
    }));

    const { requireOrgType: requireOrgTypeMocked } = await import(
      "../../src/middlewares/auth.js"
    );

    const req = { user: { organizationId: "org-uuid" } };
    const res = {};
    const next = vi.fn();

    await requireOrgTypeMocked("HOSPITAL")(req, res, next);

    // The module under test was loaded after vi.doMock, so its
    // AppError class identity differs from the one imported at
    // the top of this file. Assert on the contract the global
    // errorHandler actually reads (.status / .message) rather
    // than the prototype chain.
    const err = next.mock.calls[0][0];
    expect(err.status).toBe(403);
    expect(err.message).toBe("Insufficient organization type");
  });

  it("returns 401 when the org referenced in the JWT no longer exists", async () => {
    vi.doMock("../../src/config/prisma.js", () => ({
      prisma: {
        organization: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      },
    }));

    const { requireOrgType: requireOrgTypeMocked } = await import(
      "../../src/middlewares/auth.js"
    );

    const req = { user: { organizationId: "deleted-org-uuid" } };
    const res = {};
    const next = vi.fn();

    await requireOrgTypeMocked("HOSPITAL")(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err.status).toBe(401);
    expect(err.message).toBe("Authentication required");
  });
});

// =============================================================================
// requireOrgType — JWT claim short-circuit
// =============================================================================
//
// When the Supabase custom access token hook stamps organization_type
// into the JWT, requireAuth populates req.user.organizationType and
// requireOrgType must use it directly. The DB lookup must be skipped
// entirely — these tests assert that prisma.organization.findUnique is
// never called when the claim is present.

describe("requireOrgType — JWT claim short-circuits the DB lookup", () => {
  let findUnique;

  beforeEach(() => {
    vi.resetModules();
    findUnique = vi.fn();
    vi.doMock("../../src/config/prisma.js", () => ({
      prisma: { organization: { findUnique } },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls next() with no error and never touches Prisma when the claim matches", async () => {
    const { requireOrgType: requireOrgTypeMocked } = await import(
      "../../src/middlewares/auth.js"
    );

    const req = {
      user: { organizationId: "org-uuid", organizationType: "HOSPITAL" },
    };
    const res = {};
    const next = vi.fn();

    await requireOrgTypeMocked("HOSPITAL")(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns 403 and never touches Prisma when the claim is in the wrong allow-list", async () => {
    const { requireOrgType: requireOrgTypeMocked } = await import(
      "../../src/middlewares/auth.js"
    );

    const req = {
      user: { organizationId: "org-uuid", organizationType: "VENDOR" },
    };
    const res = {};
    const next = vi.fn();

    await requireOrgTypeMocked("HOSPITAL")(req, res, next);

    const err = next.mock.calls[0][0];
    expect(err.status).toBe(403);
    expect(err.message).toBe("Insufficient organization type");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("falls back to the DB lookup when req.user.organizationType is absent", async () => {
    // Simulate the DB returning a matching type. The claim path is
    // skipped, so the existing PK lookup is exercised end-to-end.
    findUnique.mockResolvedValue({ type: "HOSPITAL" });

    const { requireOrgType: requireOrgTypeMocked } = await import(
      "../../src/middlewares/auth.js"
    );

    const req = { user: { organizationId: "org-uuid" } };
    const res = {};
    const next = vi.fn();

    await requireOrgTypeMocked("HOSPITAL")(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "org-uuid" },
      select: { type: true },
    });
  });
});

// =============================================================================
// requireAuth — populates organizationType from payload.organization_type
// =============================================================================
//
// The hook stamps organization_type for new tokens; requireAuth must
// surface it on req.user.organizationType so requireOrgType can
// short-circuit. Tokens issued before the hook change don't have the
// claim and must continue to authenticate (the field is just
// undefined on req.user).

describe("requireAuth — organizationType claim propagation", () => {
  const secret = env.SUPABASE_JWT_SECRET;

  it("populates req.user.organizationType when the token carries the claim", () => {
    const token = jwt.sign(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        organization_type: "HOSPITAL",
        role: "ORG_ADMIN",
        email: "admin@example.com",
      },
      secret,
      { algorithm: "HS256", expiresIn: "1h" },
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {};
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.organizationType).toBe("HOSPITAL");
  });

  it("leaves req.user.organizationType undefined when the claim is absent", () => {
    // Tokens issued before the hook was extended do not carry
    // organization_type. requireAuth must still authenticate; the
    // field is just undefined on req.user.
    const token = jwt.sign(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        role: "ORG_STAFF",
        email: "staff@example.com",
      },
      secret,
      { algorithm: "HS256", expiresIn: "1h" },
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {};
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.organizationType).toBeUndefined();
  });
});
