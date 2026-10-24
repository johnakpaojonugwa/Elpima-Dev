import { Router } from "express";

import { requireAuth } from "../middlewares/auth.js";
import { authRateLimit } from "../middlewares/rateLimitAuth.js";

// Example route that demonstrates the full auth chain end-to-end:
// `requireAuth` verifies the bearer token and populates `request.user`;
// the handler returns it as JSON. The frontend uses this to confirm
// the access token is still valid and to learn the user's
// organizationId / role (the same fields RLS reads from the JWT).
//
// Mounted at /auth, unversioned, alongside /health. Business routes
// will live under /api/v1/... — auth is plumbing, not a domain.
export const authRouter = Router();

// `authRateLimit` is mounted before `requireAuth` so an attacker
// without a valid token can't burn CPU on signature verification for
// every probe. The global 300/15min limit in app.js is a baseline;
/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get current authenticated user profile
 *     description: Returns the user metadata and claims decoded from the verified JWT access token.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user claims
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         email: { type: string, format: email }
 *                         role: { type: string, example: "HOSPITAL" }
 *                         organizationId: { type: string, format: uuid }
 *       401:
 *         description: Missing, invalid, or expired JWT token
 */
authRouter.get("/me", authRateLimit, requireAuth, (request, response) => {
  response.json({
    success: true,
    data: { user: request.user },
    user: request.user, // backward-compatible alias
    meta: {
      ...(request.correlationId ? { correlationId: request.correlationId } : {}),
    },
  });
});

