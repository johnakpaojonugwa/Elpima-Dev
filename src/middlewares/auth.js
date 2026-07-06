import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";

/**
 * Verify a Supabase access token (HS256 JWT signed with the project's
 * JWT secret) and return its decoded payload.
 *
 * Exported separately from `requireAuth` so tests can pin a
 * known-secret / known-payload round-trip without setting up an
 * Express req/res pair.
 *
 * Algorithm is pinned to HS256. The default in `jsonwebtoken` accepts
 * whatever the token's header advertises, so an `alg: none` or
 * `alg: RS256` (with a forged public key) would otherwise slip through.
 *
 * The custom access token hook on the Supabase project stamps
 * `organization_id` and `role` into every issued JWT from the
 * `users` table, so a verified token is by itself enough to
 * authorize a request — no DB lookup required for the common path.
 *
 * `SUPABASE_JWT_AUDIENCE` (optional) is enforced as the expected
 * `aud` claim when set. Fail-closed: a token without an `aud`
 * claim is rejected when the env is set.
 *
 * @param {string} token  The raw JWT (no "Bearer " prefix).
 * @param {string} secret The shared secret used to sign it.
 * @returns {object}      The decoded payload.
 * @throws  {JsonWebTokenError}  Bad signature, malformed token, wrong alg, wrong aud.
 * @throws  {TokenExpiredError} Token past its `exp` claim.
 */
export function verifySupabaseJwt(token, secret) {
  return jwt.verify(token, secret, {
    algorithms: ["HS256"],
    ...(env.SUPABASE_JWT_AUDIENCE
      ? { audience: env.SUPABASE_JWT_AUDIENCE }
      : {}),
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
export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return next(new AppError(401, "Authentication required"));
  }

  let payload;
  try {
    payload = verifySupabaseJwt(match[1], env.SUPABASE_JWT_SECRET);
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
