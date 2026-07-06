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
//
// We deliberately do NOT seed DATABASE_URL — tests that need a DB
// should fail loudly if it's missing, not silently connect to something
// unexpected.

import { existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";

const envPath = new URL("../.env", import.meta.url).pathname;
if (existsSync(envPath)) {
  loadDotenv({ path: envPath });
}

if (!process.env.SUPABASE_JWT_SECRET) {
  process.env.SUPABASE_JWT_SECRET = "test-jwt-secret-not-for-production";
}
