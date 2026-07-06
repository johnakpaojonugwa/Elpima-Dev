import "dotenv/config";
import { z } from "zod";

// Fail fast on boot if config is missing/malformed, rather than
// discovering it later via a cryptic runtime error mid-request.
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  // Used later by the auth middleware to verify incoming user JWTs.
  // Not required yet, but declared now so the schema doesn't need
  // revisiting when that step lands.
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

  CORS_ORIGIN: z.string().default("*"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
