import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Service-role client for trusted server-side operations (e.g. admin
// user management, storage access). NEVER expose this key or this
// client to the frontend — it bypasses RLS entirely.
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
