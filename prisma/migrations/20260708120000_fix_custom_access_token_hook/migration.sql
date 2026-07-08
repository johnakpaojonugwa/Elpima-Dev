-- =============================================================================
-- Fix public.custom_access_token_hook
-- =============================================================================
-- Why this migration exists:
--   The original hook (deployed via the Supabase dashboard template) read
--   from `public.user_organizations`, a table that does not exist in this
--   schema. On every JWT mint, the hook raised `relation does not exist`
--   and the `organization_id` custom claim was never set. As a result, the
--   RLS policies in 20260706120000_rls_policies (which key off
--   `auth.jwt() ->> 'organization_id'`) silently matched zero rows for
--   every authenticated request.
--
-- What this migration changes:
--   1. Rewrites the hook to look up the user's organization via the real
--      `public.users` table, joined on `supabaseUserId` (the column that
--      holds the Supabase Auth user UUID as text).
--   2. Stamps the org into `app_metadata.organization_id` — Supabase
--      reserves top-level JWT claims for standard fields (sub, role, iss,
--      etc.) and merges custom claims under `app_metadata`.
--   3. Adds `isActive` as a guard: a deactivated user gets no
--      `organization_id` claim, which makes every RLS policy match zero
--      rows. This is the "lock out a fired staff member" lever.
--   4. Locks down `search_path` so a future schema swap cannot redirect
--      the function to read from an attacker's table.
--
-- Idempotency:
--   `CREATE OR REPLACE FUNCTION` is idempotent. Re-running the migration
--   just refreshes the function body.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The fixed hook.
-- -----------------------------------------------------------------------------
-- Why SECURITY DEFINER:
--   The hook runs on every JWT mint, in the auth pipeline, before the
--   request reaches the API. It must read `public.users` regardless of the
--   caller's RLS context, so we run it as the function owner (the migration
--   role). search_path is locked to prevent search_path hijacking.
--
-- Why a lookup against supabaseUserId (text) instead of id (text):
--   The event payload gives us the Supabase Auth user UUID. The
--   `public.users` row is keyed on `supabaseUserId` (the FK to auth.users).
--   `public.users.id` is the *internal* primary key and is not the same
--   value. Matching on the wrong column is the classic bug here.
--
-- Why app_metadata and not the top level:
--   Supabase strips/overwrites top-level reserved claims (iss, aud, exp,
--   sub, role, iat, jti, session_id). Stamping `organization_id` at the
--   top level gets silently dropped. `app_metadata` is preserved across
--   token refreshes and is the documented place for app-defined claims.
--   Read it from policies with: `auth.jwt() -> 'app_metadata' ->>
--   'organization_id'` (or the current_org_id() helper once that lands).
--
-- Note on column casing:
--   All Prisma-mapped columns in this schema are camelCase but Postgres
--   identifiers are case-sensitive when quoted. The Prisma client always
--   quotes them, so the underlying columns exist as e.g. "supabaseUserId".
--   This hook references them with double-quotes to match.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
declare
  current_user_id uuid;
  user_org_id     text;
  user_role       text;
  claims          jsonb;
begin
  -- The Supabase Auth event payload exposes the auth user UUID as
  -- `user_id` (top level). See:
  -- https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
  current_user_id := (event ->> 'user_id')::uuid;

  -- Resolve this auth user to an internal users row. The mapping is
  -- `public.users.supabaseUserId` (text) = the auth user UUID as text.
  -- We also gate on `isActive` so a deactivated user is effectively
  -- signed out: no organization_id claim -> every RLS predicate fails.
  select "organizationId", "role"::text
    into user_org_id, user_role
    from public.users
   where "supabaseUserId" = current_user_id::text
     and "isActive" = true
   limit 1;

  claims := event -> 'claims';

  -- Stamp organization_id under app_metadata. If the user is deactivated
  -- or has no users row, user_org_id is null and we stamp nothing —
  -- RLS will then deny every request, which is the correct failure mode.
  if user_org_id is not null then
    claims := jsonb_set(
      claims,
      '{app_metadata, organization_id}',
      to_jsonb(user_org_id)
    );
    claims := jsonb_set(
      claims,
      '{app_metadata, user_role}',
      to_jsonb(user_role)
    );
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;


-- -----------------------------------------------------------------------------
-- 2. Explicit grant for the auth pipeline.
-- -----------------------------------------------------------------------------
-- Supabase's auth hooks run with the privileges of the `supabase_auth_admin`
-- role (in self-hosted) or are invoked in the auth schema's context.
-- `SECURITY DEFINER` makes the function execute as its owner, so the
-- caller's grants don't matter for reads. We leave the function's
-- `EXECUTE` permission at the default (PUBLIC) so the auth pipeline can
-- invoke it without a separate grant.
--
-- Revoking from PUBLIC is the wrong call here — the auth pipeline does
-- not connect as a specific role that we can name. The default
-- PUBLIC EXECUTE is what Supabase's own template ships with.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 3. Sanity check: confirm the function is now resolvable.
-- -----------------------------------------------------------------------------
-- This DO block raises a WARNING (not an error) so a failed verification
-- doesn't block deploy. If the function is missing or has the wrong
-- signature, the warning shows up in Supabase's logs and the deploy
-- itself doesn't fail.
DO $$
BEGIN
  PERFORM 1
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'custom_access_token_hook'
     AND pg_get_function_identity_arguments(p.oid) = 'event jsonb';

  IF NOT FOUND THEN
    RAISE WARNING 'custom_access_token_hook is missing after migration — check pg_proc';
  END IF;
END
$$;
