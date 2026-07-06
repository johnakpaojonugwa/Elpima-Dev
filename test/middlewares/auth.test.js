import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

import { env } from "../../src/config/env.js";
import { AppError } from "../../src/utils/AppError.js";
import { rsaKeypair, signRs256 } from "../fixtures/rsaKeypair.js";
import {
  requireAuth,
  requireOrgType,
  requireRole,
  verifySupabaseJwt,
} from "../../src/middlewares/auth.js";

// The audience and JWKS tests mutate process.env before re-importing
// the auth module under test (vi.resetModules + dynamic import). The
// rest of the suite must see those env vars unset or the default
// HS256 + no-audience path is silently broken. Clearing in afterEach
// (not beforeEach) lets the same test set the env and read it back in
// the same run.
afterEach(() => {
  delete process.env.SUPABASE_JWT_AUDIENCE;
  delete process.env.SUPABASE_JWKS_URL;
  vi.restoreAllMocks();
});

// =============================================================================
// verifySupabaseJwt — pure JWT verification
// =============================================================================

describe("verifySupabaseJwt", () => {
  // Stable test secret; SUPABASE_JWT_SECRET is seeded by test/setup.js
  // when not set in the environment.
  const secret = env.SUPABASE_JWT_SECRET;

  it("returns the decoded payload for a valid HS256 token", async () => {
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

    const payload = await verifySupabaseJwt(token, secret);

    expect(payload.sub).toBe("auth-user-uuid");
    expect(payload.organization_id).toBe("org-uuid");
    expect(payload.role).toBe("ORG_ADMIN");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = jwt.sign({ sub: "x" }, "wrong-secret", {
      algorithm: "HS256",
      expiresIn: "1h",
    });

    await expect(verifySupabaseJwt(token, secret)).rejects.toThrow(
      jwt.JsonWebTokenError,
    );
  });

  it("rejects an expired token with TokenExpiredError", async () => {
    const token = jwt.sign(
      { sub: "x" },
      secret,
      { algorithm: "HS256", expiresIn: -1 }, // already expired
    );

    await expect(verifySupabaseJwt(token, secret)).rejects.toThrow(
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
    await expect(
      verifySupabaseJwt(forgedToken, secret),
    ).rejects.toThrow();
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

  it("populates req.user and calls next() with no error for a valid token", async () => {
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

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith(); // no error
    expect(req.user).toEqual({
      supabaseUserId: "auth-user-uuid",
      organizationId: "org-uuid",
      role: "ORG_STAFF",
      email: "staff@example.com",
    });
  });

  it("rejects a token that lacks the organization_id custom claim", async () => {
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

    await requireAuth(req, res, next);

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

  it("populates req.user.organizationType when the token carries the claim", async () => {
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

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.organizationType).toBe("HOSPITAL");
  });

  it("leaves req.user.organizationType undefined when the claim is absent", async () => {
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

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user.organizationType).toBeUndefined();
  });
});

// =============================================================================
// verifySupabaseJwt — SUPABASE_JWT_AUDIENCE enforcement
// =============================================================================
//
// When SUPABASE_JWT_AUDIENCE is set, jsonwebtoken enforces the `aud`
// claim against that value. We test three cases:
//   1. Audience set, token has matching aud -> accepted.
//   2. Audience set, token has wrong aud    -> rejected.
//   3. Audience set, token has no aud       -> rejected (fail-closed
//      for legacy Supabase tokens that don't stamp aud).
//
// Each test mutates process.env BEFORE vi.resetModules + dynamic
// import, so the auth module re-loads with the env override in place.
// The afterEach at the top of the file clears the env between tests.

describe("verifySupabaseJwt — SUPABASE_JWT_AUDIENCE", () => {
  const secret = env.SUPABASE_JWT_SECRET;

  async function loadAuthModule() {
    vi.resetModules();
    return import("../../src/middlewares/auth.js");
  }

  it("accepts a token whose `aud` matches the configured audience", async () => {
    process.env.SUPABASE_JWT_AUDIENCE = "authenticated";
    const { verifySupabaseJwt: verifyWithAud } = await loadAuthModule();

    const token = jwt.sign(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        role: "ORG_ADMIN",
      },
      secret,
      { algorithm: "HS256", audience: "authenticated", expiresIn: "1h" },
    );

    const payload = await verifyWithAud(token, secret);
    expect(payload.organization_id).toBe("org-uuid");
  });

  it("rejects a token whose `aud` does not match the configured audience", async () => {
    process.env.SUPABASE_JWT_AUDIENCE = "authenticated";
    const { verifySupabaseJwt: verifyWithAud } = await loadAuthModule();

    const token = jwt.sign(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        role: "ORG_ADMIN",
      },
      secret,
      { algorithm: "HS256", audience: "some-other-audience", expiresIn: "1h" },
    );

    await expect(verifyWithAud(token, secret)).rejects.toThrow(
      jwt.JsonWebTokenError,
    );
  });

  it("rejects a token that has no `aud` claim when the env is set", async () => {
    // A real-world scenario: a Supabase project emits tokens without
    // `aud` by default. The moment SUPABASE_JWT_AUDIENCE is set, those
    // tokens must fail closed — fail-open would let un-audienced
    // tokens through, which defeats the point of the check.
    process.env.SUPABASE_JWT_AUDIENCE = "authenticated";
    const { verifySupabaseJwt: verifyWithAud } = await loadAuthModule();

    const token = jwt.sign(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        role: "ORG_ADMIN",
      },
      secret,
      { algorithm: "HS256", expiresIn: "1h" },
    );

    await expect(verifyWithAud(token, secret)).rejects.toThrow(
      jwt.JsonWebTokenError,
    );
  });
});

// =============================================================================
// verifySupabaseJwt — JWKS / RS256
// =============================================================================
//
// When SUPABASE_JWKS_URL is set, the verifier fetches the signing key
// from a JWKS endpoint by `kid` and verifies the token with RS256.
// We stub `jwks-rsa` at the module boundary with `vi.doMock` +
// `vi.resetModules` (the same pattern the prisma tests in this file
// already use) so the SUT's `import jwksRsa from "jwks-rsa"` is
// replaced by a stub client whose `getSigningKey` we control.
//
// The actual RS256 sign/verify round-trip is real — we generate an
// RSA keypair with node:crypto, sign the token with the private key,
// and let the SUT verify it with the public key (returned by the
// stub JWKS client). Mocking jsonwebtoken.verify would defeat the
// test; the only thing we want to control is the JWKS lookup.

describe("verifySupabaseJwt — JWKS / RS256", () => {
  const KID = "test-key-1";
  const FAKE_JWKS_URL = "https://example.test/.well-known/jwks.json";

  async function loadAuthModule() {
    vi.resetModules();
    return import("../../src/middlewares/auth.js");
  }

  it("accepts a token whose kid resolves to a JWKS key (RS256 round-trip)", async () => {
    process.env.SUPABASE_JWKS_URL = FAKE_JWKS_URL;
    const { publicKey, privateKey } = rsaKeypair();
    // jwks-rsa is CJS with module.exports = factory. The ESM default
    // import in the SUT resolves to that factory, so the mock must
    // be { default: vi.fn(() => stub) }.
    vi.doMock("jwks-rsa", () => ({
      default: vi.fn(() => ({
        getSigningKey: (_token, cb) =>
          cb(null, { getPublicKey: () => publicKey }),
      })),
    }));
    const { verifySupabaseJwt: verifyWithJwks } = await loadAuthModule();

    const token = signRs256(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        role: "ORG_ADMIN",
      },
      privateKey,
      KID,
    );

    const payload = await verifyWithJwks(token, "ignored-secret");
    expect(payload.organization_id).toBe("org-uuid");
    expect(payload.role).toBe("ORG_ADMIN");
  });

  it("rejects an HS256 token when JWKS is the configured verifier (alg pin)", async () => {
    // With algorithms: ["RS256"], jsonwebtoken rejects an HS256 token
    // header. The error is a JsonWebTokenError with message "invalid
    // algorithm".
    //
    // Note: our verifyRs256WithJwks wrapper calls the JWKS resolver
    // before handing off to jsonwebtoken (so it can translate JWKS
    // errors), so getSigningKey IS called once — the algorithm check
    // happens at the jwt.verify step, not before the lookup.
    process.env.SUPABASE_JWKS_URL = FAKE_JWKS_URL;
    const { publicKey } = rsaKeypair();
    vi.doMock("jwks-rsa", () => ({
      default: vi.fn(() => ({
        getSigningKey: (_token, cb) =>
          cb(null, { getPublicKey: () => publicKey }),
      })),
    }));
    const { verifySupabaseJwt: verifyWithJwks } = await loadAuthModule();

    const token = jwt.sign(
      {
        sub: "attacker",
        organization_id: "org-uuid",
        role: "PLATFORM_ADMIN",
      },
      "any-secret",
      { algorithm: "HS256", expiresIn: "1h" },
    );

    await expect(verifyWithJwks(token, "any-secret")).rejects.toThrow(
      jwt.JsonWebTokenError,
    );
  });

  it("translates JWKS lookup failures to JsonWebTokenError (401, not 500)", async () => {
    // The jwks-rsa client surfaces plain Error objects (e.g. "No
    // matching key") through its callback. We wrap those in
    // JsonWebTokenError at the auth boundary so the global
    // errorHandler classifies them as 401 instead of 500.
    process.env.SUPABASE_JWKS_URL = FAKE_JWKS_URL;
    const { privateKey } = rsaKeypair();
    const token = signRs256(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        role: "ORG_ADMIN",
      },
      privateKey,
      "unknown-kid",
    );

    vi.doMock("jwks-rsa", () => ({
      default: vi.fn(() => ({
        getSigningKey: (_token, cb) =>
          cb(new Error("No matching key"), null),
      })),
    }));
    const { verifySupabaseJwt: verifyWithJwks } = await loadAuthModule();

    let caught;
    try {
      await verifyWithJwks(token, "ignored-secret");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(jwt.JsonWebTokenError);
    expect(caught.message).toBe("No matching key");
  });

  it("HS256 still works when SUPABASE_JWKS_URL is unset (regression guard)", async () => {
    // No vi.doMock — the real jwks-rsa is loaded but never constructed
    // because the env is unset. This catches the branch disappearing
    // during a refactor.
    const { verifySupabaseJwt: verifyWithoutJwks } = await loadAuthModule();

    const secret = env.SUPABASE_JWT_SECRET;
    const token = jwt.sign(
      {
        sub: "auth-user-uuid",
        organization_id: "org-uuid",
        role: "ORG_ADMIN",
      },
      secret,
      { algorithm: "HS256", expiresIn: "1h" },
    );

    const payload = await verifyWithoutJwks(token, secret);
    expect(payload.organization_id).toBe("org-uuid");
  });
});
