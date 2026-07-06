import jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";

// Lazy JWKS client. Only constructed when SUPABASE_JWKS_URL is set,
// so the default HS256 path doesn't pay any setup cost (and doesn't
// require a network round-trip at boot).
//
// `cache: true` is the default in jwks-rsa but spelled out for
// clarity — the JWKS endpoint publishes infrequently and we don't
// want to hit it on every request. `rateLimit: true` protects the
// upstream against a runaway verifier.
let jwksClient;
function getJwksClient() {
  if (!jwksClient) {
    jwksClient = jwksRsa({
      jwksUri: env.SUPABASE_JWKS_URL,
      cache: true,
      rateLimit: true,
    });
  }
  return jwksClient;
}

// Verifies an RS256 token by fetching the signing key from JWKS by
// `kid` and delegating to jsonwebtoken. Wrapped in a Promise so the
// function always returns a thenable — required so `requireAuth` and
// the tests can `await` it uniformly across the HS256 and RS256 paths.
//
// JWKS client errors (e.g. "No matching key") are translated to
// JsonWebTokenError so the global errorHandler classifies them as
// 401 instead of 500 — the auth path always raises a JWT-shaped error.
function verifyRs256WithJwks(token) {
  return new Promise((resolve, reject) => {
    getJwksClient().getSigningKey(token, (jwksErr, jwksKey) => {
      if (jwksErr) {
        return reject(new jwt.JsonWebTokenError(jwksErr.message));
      }
      jwt.verify(
        token,
        jwksKey.getPublicKey(),
        {
          algorithms: ["RS256"],
          ...(env.SUPABASE_JWT_AUDIENCE
            ? { audience: env.SUPABASE_JWT_AUDIENCE }
            : {}),
        },
        (verifyErr, payload) => {
          if (verifyErr) return reject(verifyErr);
          resolve(payload);
        },
      );
    });
  });
}

/**
 * Verify a Supabase access token and return its decoded payload.
 *
 * Exported separately from `requireAuth` so tests can pin a
 * known-secret / known-payload round-trip without setting up an
 * Express req/res pair.
 *
 * Verification path is selected at boot from `env.SUPABASE_JWKS_URL`:
 *
 *   - unset (default): HS256 + shared secret. Algorithm is pinned —
 *     jsonwebtoken rejects `alg: none` or `alg: RS256` tokens.
 *   - set:             RS256, signing key fetched from the JWKS
 *     endpoint by `kid`. The `secret` argument is ignored.
 *
 * The custom access token hook on the Supabase project stamps
 * `organization_id` and `role` into every issued JWT from the
 * `users` table, so a verified token is by itself enough to
 * authorize a request — no DB lookup required for the common path.
 *
 * `SUPABASE_JWT_AUDIENCE` (optional) is enforced as the expected
 * `aud` claim on both branches. Fail-closed: a token without an
 * `aud` claim is rejected when the env is set.
 *
 * Deploy order: set `SUPABASE_JWKS_URL` only after the Supabase
 * project is rotated to issue RS256 tokens. Setting it first
 * rejects every existing HS256 token — clients re-authenticate,
 * which is fine in steady state but is a hard 401 storm during
 * a partial rollout.
 *
 * @param {string}  token   The raw JWT (no "Bearer " prefix).
 * @param {string?} _secret The shared secret used to sign HS256
 *                          tokens. Ignored when JWKS verification
 *                          is enabled; kept in the signature so
 *                          `requireAuth` doesn't have to branch.
 * @returns {Promise<object>}  The decoded payload.
 * @throws  {JsonWebTokenError}  Bad signature, malformed token, wrong alg,
 *                               wrong aud, unknown kid.
 * @throws  {TokenExpiredError}  Token past its `exp` claim.
 */
export async function verifySupabaseJwt(token, _secret) {
  const audience = env.SUPABASE_JWT_AUDIENCE
    ? { audience: env.SUPABASE_JWT_AUDIENCE }
    : {};

  if (env.SUPABASE_JWKS_URL) {
    return verifyRs256WithJwks(token);
  }
  return jwt.verify(token, _secret, {
    algorithms: ["HS256"],
    ...audience,
  });
}

/**
 * Express middleware. Reads the bearer token from the Authorization
 * header, verifies it, and populates `req.user` with the application-
 * side fields a handler might need (supabaseUserId, organizationId,
 * role, email).
 *
 * On any failure, delegates to the global errorHandler with an
 * AppError; the errorHandler already classifies JWT errors by name
 * (TokenExpiredError -> 401 "Session expired", JsonWebTokenError ->
 * 401 "Authentication required"), so we don't have to re-classify
 * here.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return next(new AppError(401, "Authentication required"));
  }

  let payload;
  try {
    payload = await verifySupabaseJwt(match[1], env.SUPABASE_JWT_SECRET);
  } catch {
    // Re-throw so the errorHandler can pick the right message via
    // err.name (TokenExpiredError vs JsonWebTokenError vs
    // NotBeforeError). Wrapping in AppError would lose that signal.
    return next(new AppError(401, "Authentication required"));
  }

  // Custom-claim presence is the security boundary: a token without
  // organization_id means either the hook isn't deployed, the
  // project is misconfigured, or someone is replaying a token from
  // before the hook shipped. None of those should authenticate.
  if (!payload.organization_id) {
    return next(
      new AppError(
        401,
        "Authentication required",
      ),
    );
  }

  req.user = {
    supabaseUserId: payload.sub,
    organizationId: payload.organization_id,
    role: payload.role,
    email: payload.email,
    // Optional. The Supabase custom access token hook stamps this once
    // it's extended (the organization_id claim is the only one it
    // currently emits). Undefined for tokens issued before that hook
    // change — requireOrgType falls back to a DB lookup in that case.
    organizationType: payload.organization_type,
  };

  next();
}

/**
 * Gate a route by user role. Must be mounted AFTER `requireAuth` —
 * the guard fails closed (401) if there's no req.user.
 *
 * Usage: `router.get("/admin", requireAuth, requireRole("ORG_ADMIN"), handler)`
 *
 * Roles are the UserRole enum from prisma/schema.prisma:
 *   ORG_ADMIN, ORG_STAFF, PLATFORM_ADMIN
 *
 * @param  {...string} allowed  The role(s) that may proceed.
 */
export function requireRole(...allowed) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required"));
    }
    if (!allowed.includes(req.user.role)) {
      return next(new AppError(403, "Insufficient role"));
    }
    next();
  };
}

/**
 * Gate a route by organization type. Must be mounted AFTER
 * `requireAuth`.
 *
 * The custom access token hook can stamp `organization_type` into
 * every issued JWT (it already stamps `organization_id`); when the
 * claim is present, `req.user.organizationType` is set by
 * `requireAuth` and we use it directly, skipping the DB round-trip.
 * When the claim is absent (tokens issued before the hook was
 * extended), we fall back to a single PK lookup of the org's type.
 *
 * Why trust the claim when present: the custom access token hook is
 * the same source of truth that RLS already reads via
 * `auth.jwt() ->> 'organization_id'`, so a verified
 * `organization_type` claim is at least as trustworthy as the DB row.
 * It also keeps the lookup off the hot path for every request once
 * the hook is updated.
 *
 * Usage: `router.post("/quotes", requireAuth, requireOrgType("HOSPITAL"), handler)`
 *
 * Types are the OrgType enum from prisma/schema.prisma:
 *   HOSPITAL, VENDOR
 *
 * @param  {...string} allowed  The org type(s) that may proceed.
 */
export function requireOrgType(...allowed) {
  return async (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required"));
    }

    // Fast path: claim present. Skip the DB lookup entirely.
    if (req.user.organizationType) {
      if (!allowed.includes(req.user.organizationType)) {
        return next(new AppError(403, "Insufficient organization type"));
      }
      return next();
    }

    // Slow path: claim absent. Look the org up by id. The "org
    // deleted" 401 branch only makes sense here — with a claim, a
    // stale token's claim is still a valid authorization decision
    // until the token expires.
    try {
      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { type: true },
      });

      if (!org) {
        return next(
          new AppError(401, "Authentication required"),
        );
      }

      if (!allowed.includes(org.type)) {
        return next(new AppError(403, "Insufficient organization type"));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
