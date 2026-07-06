-- =============================================================================
-- RLS policies + audit-log REVOKE
-- =============================================================================
-- Why this migration exists:
--   The schema is multi-tenant by convention (every business row carries an
--   organizationId or a parent FK that resolves to one), but until now there
--   was no enforcement at the database level. A bug in the API, a
--   misconfigured admin tool, or a future service using supabase-js directly
--   could read or mutate any tenant's rows. CLAUDE.md and
--   docs/compliance-standards.md call this out as a non-negotiable guardrail.
--
-- How RLS is meant to be used in this project:
--   - The Prisma connection string connects as the schema owner (typically
--     `postgres`), which has BYPASSRLS by default. Existing Prisma code is
--     unaffected by these policies.
--   - The Supabase `authenticated` role — used by any future frontend,
--     server-side per-request client, or non-bypassing Prisma role — is
--     subject to every policy defined here. That role cannot read or write
--     outside its own tenant.
--   - The `organization_id` JWT claim is the tenant identifier. A Supabase
--     Auth custom hook (out of scope for this commit) is responsible for
--     stamping it on every issued JWT from `users.organizationId`.
--
-- Predicate strategy:
--   All policies call `public.current_org_id()`, a SECURITY INVOKER STABLE
--   function that reads `auth.jwt() ->> 'organization_id'`. Centralizing the
--   lookup keeps policies short and the missing-claim behavior consistent
--   (returns NULL, which makes every `column = current_org_id()` predicate
--   silently match zero rows — the secure default).
--
-- Idempotency:
--   CREATE POLICY has no IF NOT EXISTS form, so every CREATE POLICY is
--   preceded by DROP POLICY IF EXISTS. ALTER TABLE ... ENABLE ROW LEVEL
--   SECURITY is naturally idempotent. CREATE OR REPLACE FUNCTION is
--   idempotent. REVOKE is idempotent. Re-running this migration is safe.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The tenant-lookup helper
-- -----------------------------------------------------------------------------
-- Reads the `organization_id` custom claim from the current request's JWT.
-- SECURITY INVOKER so the caller's privileges apply (we don't want a
-- definer-time bypass of RLS). STABLE so the planner can call it once per
-- query. search_path is locked down so a future search_path change can't
-- redirect this to a hostile schema.
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT auth.jwt() ->> 'organization_id'
$$;


-- -----------------------------------------------------------------------------
-- 2. Enable RLS on every tenant-scoped and PHI-adjacent table
-- -----------------------------------------------------------------------------
-- ENABLE ROW LEVEL SECURITY is idempotent. Even if a future Prisma migration
-- recreates one of these tables, RLS will still be on after this runs.
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


-- -----------------------------------------------------------------------------
-- 3. organizations — a user can read their own org row; everything else is
--    service-role territory (registration, admin tooling, etc.)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_select_own ON public.organizations;
CREATE POLICY organizations_select_own ON public.organizations
  FOR SELECT
  TO authenticated
  USING (id = current_org_id());


-- -----------------------------------------------------------------------------
-- 4. users — a user can read their own row AND other users in the same org
--    (so an org admin can see staff). Writes (creation, role changes) go
--    through the service role.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS users_select_own_or_same_org ON public.users;
CREATE POLICY users_select_own_or_same_org ON public.users
  FOR SELECT
  TO authenticated
  USING (
    "supabaseUserId" = auth.uid()::text
    OR "organizationId" = current_org_id()
  );


-- -----------------------------------------------------------------------------
-- 5. licenses — PHI-adjacent (hospital verification documents). A user can
--    read licenses attached to their own org; writes go through the service
--    role (review workflow).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS licenses_select_own_org ON public.licenses;
CREATE POLICY licenses_select_own_org ON public.licenses
  FOR SELECT
  TO authenticated
  USING ("organizationId" = current_org_id());


-- -----------------------------------------------------------------------------
-- 6. products — vendors manage their own catalog; hospitals browse cross-
--    tenant. The SELECT is intentionally permissive (any authenticated user
--    can read any product). If the business later wants to hide products
--    from suspended or unverified vendors, gate it through a join on
--    `organizations` and add a status predicate here.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS products_select_all ON public.products;
CREATE POLICY products_select_all ON public.products
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS products_insert_own ON public.products;
CREATE POLICY products_insert_own ON public.products
  FOR INSERT
  TO authenticated
  WITH CHECK ("vendorId" = current_org_id());

DROP POLICY IF EXISTS products_update_own ON public.products;
CREATE POLICY products_update_own ON public.products
  FOR UPDATE
  TO authenticated
  USING ("vendorId" = current_org_id())
  WITH CHECK ("vendorId" = current_org_id());

DROP POLICY IF EXISTS products_delete_own ON public.products;
CREATE POLICY products_delete_own ON public.products
  FOR DELETE
  TO authenticated
  USING ("vendorId" = current_org_id());


-- -----------------------------------------------------------------------------
-- 7. categories — global taxonomy. Everyone can read; no one writes from
--    the app (seeded via migration / admin SQL).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS categories_select_all ON public.categories;
CREATE POLICY categories_select_all ON public.categories
  FOR SELECT
  TO authenticated
  USING (true);


-- -----------------------------------------------------------------------------
-- 8. quotes — both hospital and vendor on a quote can read/write it. The
--    caller must be on the hospital side OR the vendor side; nobody else.
--    DELETE is intentionally absent: quotes are an immutable record of what
--    was offered/accepted, even after the order is fulfilled.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS quotes_select_party ON public.quotes;
CREATE POLICY quotes_select_party ON public.quotes
  FOR SELECT
  TO authenticated
  USING (
    "hospitalId" = current_org_id()
    OR "vendorId" = current_org_id()
  );

DROP POLICY IF EXISTS quotes_insert_party ON public.quotes;
CREATE POLICY quotes_insert_party ON public.quotes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "hospitalId" = current_org_id()
    OR "vendorId" = current_org_id()
  );

DROP POLICY IF EXISTS quotes_update_party ON public.quotes;
CREATE POLICY quotes_update_party ON public.quotes
  FOR UPDATE
  TO authenticated
  USING (
    "hospitalId" = current_org_id()
    OR "vendorId" = current_org_id()
  )
  WITH CHECK (
    "hospitalId" = current_org_id()
    OR "vendorId" = current_org_id()
  );


-- -----------------------------------------------------------------------------
-- 9. quote_items — join through the parent quote. The item is visible to
--    a caller if and only if the parent quote is.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS quote_items_select_via_quote ON public.quote_items;
CREATE POLICY quote_items_select_via_quote ON public.quote_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.id = quote_items."quoteId"
        AND (q."hospitalId" = current_org_id() OR q."vendorId" = current_org_id())
    )
  );

DROP POLICY IF EXISTS quote_items_modify_via_quote ON public.quote_items;
CREATE POLICY quote_items_modify_via_quote ON public.quote_items
  FOR ALL
  TO authenticated
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


-- -----------------------------------------------------------------------------
-- 10. orders — a hospital can read its own orders. INSERT/UPDATE/DELETE go
--     through the service role (orders are admin/fulfillment-driven, not
--     self-service from the API).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS orders_select_own_org ON public.orders;
CREATE POLICY orders_select_own_org ON public.orders
  FOR SELECT
  TO authenticated
  USING ("hospitalId" = current_org_id());


-- -----------------------------------------------------------------------------
-- 11. order_items — visible to a caller if and only if the parent order is.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS order_items_select_via_order ON public.order_items;
CREATE POLICY order_items_select_via_order ON public.order_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items."orderId"
        AND o."hospitalId" = current_org_id()
    )
  );


-- -----------------------------------------------------------------------------
-- 12. audit_logs — append-only from the app, scoped to the caller's org.
--     - SELECT: a user can see their own org's audit rows.
--     - INSERT: a user can only write rows tagged with their own org
--       (prevents a caller from forging audit history for another tenant).
--       The service role bypasses this entirely; legitimate cross-org audit
--       writes (platform admin) go through the service role.
--     - No UPDATE / DELETE policy is created. The REVOKE below is the
--       second line of defense: even if a future policy accidentally
--       permitted writes, the bare privilege is gone.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_logs_select_own_org ON public.audit_logs;
CREATE POLICY audit_logs_select_own_org ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING ("organizationId" = current_org_id());

DROP POLICY IF EXISTS audit_logs_insert_own_org ON public.audit_logs;
CREATE POLICY audit_logs_insert_own_org ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK ("organizationId" = current_org_id());


-- -----------------------------------------------------------------------------
-- 13. audit_logs — revoke UPDATE and DELETE from every app-facing role.
--     The schema owner (the role this migration runs as, typically
--     `postgres` via Prisma) keeps the grant from the table's CREATE TABLE
--     statement, so emergency corrections remain possible. The
--     `authenticated` role and PUBLIC lose the privilege entirely; no app
--     code path running as those roles can tamper with audit history.
--     REVOKE is idempotent.
-- -----------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON public.audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE ON public.audit_logs FROM authenticated;
