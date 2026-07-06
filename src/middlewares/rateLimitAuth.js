import rateLimit from "express-rate-limit";

// Tighter per-route limit for /auth/me. The global limit in app.js is
// 300/15min as a baseline; this layer is 10x stricter because /auth/me
// is a token-validation endpoint a legitimate client hits once per
// access-token refresh (~1/min). 30/15min = 2/min sustained.
//
// Why 30 and not 60: a user with multiple browser tabs polling
// /auth/me for token-refresh status will hit the 31st request in a
// 15-min window and get a 429. Adjust up if real usage shows this
// is too tight in practice — a one-line change.
//
// Mount order matters: this middleware is mounted BEFORE requireAuth
// on the route so an attacker without a valid token can't burn CPU
// on signature verification for every probe.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // The 429 body shape mirrors the global limit's default but as
  // JSON, matching the rest of the API's error envelope.
  message: { error: { message: "Too many requests" } },
});
