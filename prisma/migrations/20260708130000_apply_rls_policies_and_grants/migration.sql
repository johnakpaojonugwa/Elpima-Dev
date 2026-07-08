-- =============================================================================
-- Apply RLS policies + DML grants to the live database
-- =============================================================================
-- Why this migration exists:
--   The committed migration 20260706120000_rls_policies described the
--   intended end state but was never actually applied: pg_policy had zero
--   rows on the live DB, public.current_org_id() did not exist, the
--   audit_logs UPDATE/DELETE revoke was missing, and the authenticated
--   role had no DML grants on any tenant table. With the JWT custom hook
--   now fixed (20260708120000_fix_custom_access_token_hook), the
--   organization_id claim is finally being stamped, and these policies
--   become observable end-to-end.
--
-- This file is a faithful application of the committed intent, plus the
-- one additive policy flagged in the prior diagnosis: users_insert_self
-- and users_update_self. The committed file had no write policy on
-- users, which means a future per-request supabase-js client could not
-- create or edit its own User row.
--
-- Idempotency: every CREATE POLICY is preceded by DROP POLICY IF EXISTS.
-- CREATE OR REPLACE FUNCTION is idempotent. GRANT/REVOKE are idempotent.
-- Re-running this migration is safe.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Restore the default DML grants for the authenticated role.
--    RLS policies can only filter rows the role can already touch.
--    Without these GRANTs, every authenticated query is rejected at the
--    table-privilege layer before RLS is even consulted.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.organizations,
  public.users,
  public.licenses,
  public.products,
  public.categories,
  public.quotes,
  public.quote_items,
  public.orders,
  public.order_items
TO authenticated;

-- audit_logs: SELECT + INSERT only. UPDATE/DELETE are revoked in step 13.
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;


-- -----------------------------------------------------------------------------
-- 2. The tenant-lookup helper. Reads `organization_id` from the JWT.
--    SECURITY INVOKER so the caller's privileges apply (we do not want a
--    definer-time bypass of RLS). STABLE so the planner calls it once
--    per query. search_path is locked down.
--
--    Reads from app_metadata (where the custom_access_token_hook stamps
--    the claim), not from the top level. Supabase strips/overwrites
--    top-level reserved claims, so app_metadata is the only durable
--    location for custom claims.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'organization_id'
$$;


-- -----------------------------------------------------------------------------
-- 3. Enable RLS on every tenant-scoped and PHI-adjacent table. Idempotent.
-- -----------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licenses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs   ENABLE ROW LEVEL SECURITY;


-- =========================================================================
-- 4. organizations — a user reads only their own org row.
--    No write policy: registration is service-role territory.
-- =========================================================================
DROP POLICY IF EXISTS organizations_select_own ON public.organizations;
CREATE POLICY organizations_select_own ON public.organizations
  FOR SELECT TO authenticated
  USING (id = current_org_id());


-- =========================================================================
-- 5. users — a user reads their own row AND other users in the same org
--    (so an org admin can see staff). PATCH ADDITION relative to the
--    committed file: INSERT and UPDATE policies so a future per-request
--    supabase-js client can self-onboard / self-edit.
-- =========================================================================
DROP POLICY IF EXISTS users_select_own_or_same_org ON public.users;
CREATE POLICY users_select_own_or_same_org ON public.users
  FOR SELECT TO authenticated
  USING (
    "supabaseUserId" = auth.uid()::text
    OR "organizationId" = current_org_id()
  );

DROP POLICY IF EXISTS users_insert_self ON public.users;
CREATE POLICY users_insert_self ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    "supabaseUserId" = auth.uid()::text
    AND "organizationId" = current_org_id()
  );

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users
  FOR UPDATE TO authenticated
  USING ("supabaseUserId" = auth.uid()::text)
  WITH CHECK (
    "supabaseUserId" = auth.uid()::text
    AND "organizationId" = current_org_id()
  );


-- =========================================================================
-- 6. licenses — PHI-adjacent. A user reads their own org's licenses.
--    Writes go through the service role (review workflow).
-- =========================================================================
DROP POLICY IF EXISTS licenses_select_own_org ON public.licenses;
CREATE POLICY licenses_select_own_org ON public.licenses
  FOR SELECT TO authenticated
  USING ("organizationId" = current_org_id());


-- =========================================================================
-- 7. products — vendors manage their own catalog; hospitals browse cross-
--    tenant. SELECT is intentionally permissive.
-- =========================================================================
DROP POLICY IF EXISTS products_select_all ON public.products;
CREATE POLICY products_select_all ON public.products
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS products_insert_own ON public.products;
CREATE POLICY products_insert_own ON public.products
  FOR INSERT TO authenticated
  WITH CHECK ("vendorId" = current_org_id());

DROP POLICY IF EXISTS products_update_own ON public.products;
CREATE POLICY products_update_own ON public.products
  FOR UPDATE TO authenticated
  USING ("vendorId" = current_org_id())
  WITH CHECK ("vendorId" = current_org_id());

DROP POLICY IF EXISTS products_delete_own ON public.products;
CREATE POLICY products_delete_own ON public.products
  FOR DELETE TO authenticated
  USING ("vendorId" = current_org_id());


-- =========================================================================
-- 8. categories — global taxonomy. SELECT for all; no app-side writes.
-- =========================================================================
DROP POLICY IF EXISTS categories_select_all ON public.categories;
CREATE POLICY categories_select_all ON public.categories
  FOR SELECT TO authenticated
  USING (true);


-- =========================================================================
-- 9. quotes — hospital OR vendor on a quote can read/write it.
--    No DELETE policy: quotes are an immutable record.
-- =========================================================================
DROP POLICY IF EXISTS quotes_select_party ON public.quotes;
CREATE POLICY quotes_select_party ON public.quotes
  FOR SELECT TO authenticated
  USING (
    "hospitalId" = current_org_id()
    OR "vendorId" = current_org_id()
  );

DROP POLICY IF EXISTS quotes_insert_party ON public.quotes;
CREATE POLICY quotes_insert_party ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (
    "hospitalId" = current_org_id()
    OR "vendorId" = current_org_id()
  );

DROP POLICY IF EXISTS quotes_update_party ON public.quotes;
CREATE POLICY quotes_update_party ON public.quotes
  FOR UPDATE TO authenticated
  USING (
    "hospitalId" = current_org_id()
    OR "vendorId" = current_org_id()
  )
  WITH CHECK (
    "hospitalId" = current_org_id()
    OR "vendorId" = current_org_id()
  );


-- =========================================================================
-- 10. quote_items — join through parent quote.
-- =========================================================================
DROP POLICY IF EXISTS quote_items_select_via_quote ON public.quote_items;
CREATE POLICY quote_items_select_via_quote ON public.quote_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.id = quote_items."quoteId"
        AND (q."hospitalId" = current_org_id() OR q."vendorId" = current_org_id())
    )
  );

DROP POLICY IF EXISTS quote_items_modify_via_quote ON public.quote_items;
CREATE POLICY quote_items_modify_via_quote ON public.quote_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.id = quote_items."quoteId"
        AND (q."hospitalId" = current_org_id() OR q."vendorId" = current_org_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.id = quote_items."quoteId"
        AND (q."hospitalId" = current_org_id() OR q."vendorId" = current_org_id())
    )
  );


-- =========================================================================
-- 11. orders — hospital reads its own. Writes go through service role.
-- =========================================================================
DROP POLICY IF EXISTS orders_select_own_org ON public.orders;
CREATE POLICY orders_select_own_org ON public.orders
  FOR SELECT TO authenticated
  USING ("hospitalId" = current_org_id());


-- =========================================================================
-- 12. order_items — visible iff the parent order is.
-- =========================================================================
DROP POLICY IF EXISTS order_items_select_via_order ON public.order_items;
CREATE POLICY order_items_select_via_order ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items."orderId"
        AND o."hospitalId" = current_org_id()
    )
  );


-- =========================================================================
-- 13. audit_logs — append-only from the app, scoped to the caller's org.
-- =========================================================================
DROP POLICY IF EXISTS audit_logs_select_own_org ON public.audit_logs;
CREATE POLICY audit_logs_select_own_org ON public.audit_logs
  FOR SELECT TO authenticated
  USING ("organizationId" = current_org_id());

DROP POLICY IF EXISTS audit_logs_insert_own_org ON public.audit_logs;
CREATE POLICY audit_logs_insert_own_org ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK ("organizationId" = current_org_id());


-- -----------------------------------------------------------------------------
-- 14. audit_logs — revoke UPDATE and DELETE. Second line of defense: even
--     if a future policy accidentally permitted writes, the bare privilege
--     is gone. Schema owner (typically `postgres` via Prisma) keeps the
--     grant from the table's CREATE TABLE statement.
-- -----------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON public.audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE ON public.audit_logs FROM authenticated;
