// Global test setup. Runs once per test file (vitest re-imports it per
// worker) before any test code executes.
//
// Goals:
//   1. Load .env if it's present, so tests pick up DATABASE_URL etc.
//      when running against a real DB. Don't fail if .env is missing —
//      a CI runner may rely on injected env vars instead.
//   2. Seed SUPABASE_JWT_SECRET with a known placeholder if the real
//      value isn't already in the environment. This lets the auth
//      middleware tests sign and verify tokens with a stable secret
//      without leaking the production secret into the repo.
//   3. Unset SUPABASE_JWT_AUDIENCE and SUPABASE_JWKS_URL so the
//      default HS256 + no-audience path is exercised by the bulk of
//      the suite. The audience and JWKS tests opt in by setting the
//      env var in their own scope (with an afterEach to clear it).
//      Without this, a developer's local .env would silently change
//      which verifier path the tests exercise.
//
// We deliberately do NOT seed DATABASE_URL — tests that need a DB
// should fail loudly if it's missing, not silently connect to something
// unexpected.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

// On Windows, `new URL("../.env", import.meta.url).pathname` returns
// `/C:/path/.env` (with a leading slash that breaks existsSync).
// fileURLToPath normalizes that to `C:\path\.env`.
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) {
  loadDotenv({ path: envPath });
}

if (!process.env.SUPABASE_JWT_SECRET) {
  process.env.SUPABASE_JWT_SECRET = "test-jwt-secret-not-for-production";
}

// Strip the optional env vars. Tests that exercise the audience or
// JWKS paths set them per-test (and clear them in afterEach).
delete process.env.SUPABASE_JWT_AUDIENCE;
delete process.env.SUPABASE_JWKS_URL;
