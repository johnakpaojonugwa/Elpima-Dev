import { Router } from "express";

import { requireAuth } from "../middlewares/auth.js";
import { authRateLimit } from "../middlewares/rateLimitAuth.js";

// Example route that demonstrates the full auth chain end-to-end:
// `requireAuth` verifies the bearer token and populates `req.user`;
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
// this tighter layer is the per-route floor for auth endpoints.
authRouter.get("/me", authRateLimit, requireAuth, (req, res) => {
  res.json({ user: req.user });
});
