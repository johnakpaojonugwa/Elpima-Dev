import { z } from "zod";

// Fail fast on boot if config is missing/malformed, rather than
// discovering it later via a cryptic runtime error mid-request.
//
// .env loading is the entry point's job: server.js does
// `import "dotenv/config"` for `node server.js`, test/setup.js does
// the same for vitest, and prisma.config.ts does it for migrations.
// This module just validates whatever's in process.env at the time
// it's imported. Keeping .env loading out of here means test setups
// that vi.resetModules() the module graph (e.g. to exercise env-var
// overrides) don't re-run the .env load — which would silently
// re-introduce vars the test had just deleted.
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().url(),
  // Direct (non-pooled) Postgres connection. Required for
  // Prisma's interactive transactions — the pooled DATABASE_URL
  // above goes through PgBouncer in transaction mode, which
  // cannot hold a multi-statement transaction. Migrations also
  // need this URL (see prisma.config.ts).
  DIRECT_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  // Used by the auth middleware to verify incoming user JWTs. The
  // Supabase custom access token hook signs GoTrue access tokens with
  // this secret; the same secret verifies them on the API side. Required
  // — booting with it missing means every request would 401.
  SUPABASE_JWT_SECRET: z.string().min(1),

  // Optional. The expected `aud` claim on incoming access tokens. When
  // set, jsonwebtoken rejects tokens whose `aud` doesn't match. When
  // unset, no audience check is performed (current default).
  //
  // Supabase's access tokens don't set a custom `aud` by default, so
  // leave this unset until the hook is configured to emit one.
  SUPABASE_JWT_AUDIENCE: z.string().min(1).optional(),

  // Optional. When set, verifySupabaseJwt fetches signing keys from
  // this JWKS endpoint and verifies tokens with RS256 (Supabase's
  // path to asymmetric JWTs). When unset, the legacy HS256 +
  // shared-secret path is used.
  //
  // Deploy order: this must be set ONLY after the Supabase project is
  // rotated to issue RS256 tokens and expose a JWKS endpoint. Setting
  // it first rejects every existing HS256 token — clients re-auth,
  // which is fine, but a misconfigured deploy becomes a hard 401 storm
  // until rollback. See src/middlewares/auth.js for the verifier.
  SUPABASE_JWKS_URL: z.string().url().optional(),

  // Optional bearer token required to scrape Prometheus /metrics.
  // When configured, GET /metrics requires Authorization: Bearer <METRICS_TOKEN>.
  METRICS_TOKEN: z.string().min(1).optional(),

  // Accepts a single origin, "*" (any origin, dev default), or a
  // comma-separated list. The browser's CORS check fails silently on
  // a single malformed origin, so parsing the list at the env boundary
  // catches a typo (e.g. a missing slash) before it ever reaches cors().
  CORS_ORIGIN: z
    .string()
    .default("*")
    .transform((raw) => {
      const items = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // Keep "*" as the wildcard so cors() handles credentials correctly
      // (it rejects origin:"*" + credentials:true).
      if (items.length === 0 || (items.length === 1 && items[0] === "*")) {
        return "*";
      }
      return items;
    }),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
