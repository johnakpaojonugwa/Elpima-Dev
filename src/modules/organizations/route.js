import { Router } from "express";

import { directPrisma } from "../../config/prisma.js";
import { CreateOrganizationSchema } from "./validation.js";
import { createOrganization } from "./service.js";

// =====================================================================
// Organizations route — HTTP wiring for /api/v1/organizations
// =====================================================================
//
// This router is mounted under `/api/v1/organizations` from
// src/routes/index.js. The route handler is intentionally thin:
//   1. Validate the body with the zod schema. A failure surfaces
//      as a 400 via the global errorHandler (which classifies
//      ZodError and includes a sanitized `fieldErrors` map).
//   2. Call the service. The service does the real work — DB
//      writes, audit log — and throws AppError for known business
//      failures (409 on duplicate email).
//   3. Return 201 with the created resource.
//
// The service is responsible for the audit log row. The route does
// not write to the audit log itself; the audit contract is owned
// by the service so any other entrypoint (a future CLI importer,
// an admin script) produces the same audit shape.

export const organizationsRouter = Router();

/**
 * POST /api/v1/organizations
 *
 * Body: CreateOrganizationSchema (validated below).
 * Auth: PLATFORM_ADMIN only — gated at the mount site, not here.
 *       See src/routes/index.js where this router is mounted with
 *       the `requireRole("PLATFORM_ADMIN")` middleware.
 *
 * Responses:
 *   201 — { success: true, data: { organization, user }, meta: { correlationId } }
 *   400 — Invalid request payload (zod validation)
 *   401 — Unauthenticated (requireAuth)
 *   403 — Wrong role (requireRole)
 *   409 — Duplicate email (P2002 mapped to AppError(409))
 *   500 — Anything else (Prisma, network)
 */
organizationsRouter.post("/", async (req, res, next) => {
  try {
    const input = CreateOrganizationSchema.parse(req.body);

    const { organization, user } = await createOrganization(
      // Uses unpooled directPrisma client to guarantee atomic rollback
      // on interactive $transaction without PgBouncer transaction-mode timeouts.
      directPrisma,
      input,
      // The actor's id isn't currently carried in the JWT (only
      // `sub` = Supabase auth user id is). When a follow-up
      // migration adds `app_metadata.user_id` (the public.users.id
      // we have here), this is where it gets wired in. For now,
      // we pass the actor's role and JWT subject so the audit log
      // has something to record.
      {
        role: req.user?.role ?? "PLATFORM_ADMIN",
        id: null,
        // The actor's tenant scope — used to set the audit log's
        // `organizationId` (which RLS scopes to the actor's
        // `current_org_id()`). A PLATFORM_ADMIN's JWT carries
        // their own platform-admin org id here.
        organizationId: req.user?.organizationId ?? null,
      },
    );

    res.status(201).json({
      success: true,
      data: { organization, user },
      organization, // backward-compatible alias
      user,         // backward-compatible alias
      meta: {
        ...(req.correlationId ? { correlationId: req.correlationId } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});
