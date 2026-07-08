import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "../../utils/AppError.js";

// =====================================================================
// Organizations service — business logic for the organizations module
// =====================================================================
//
// All write operations on the `organizations` table go through this
// service. The route handler is intentionally thin (parse, call,
// respond).
//
// The audit log row is written immediately after the organization
// and user rows. The three writes are sequential rather than
// wrapped in a Prisma `$transaction` because Supabase's pooled
// connection (PgBouncer in transaction mode) does not support
// interactive transactions, and the array form still requires a
// server-side BEGIN/COMMIT that pgbouncer times out on after the
// first call in a given process. The sequential shape accepts a
// narrow atomicity loss: if the user or audit log write fails
// after the org write succeeds, an orphaned org with no user and
// no audit row is the worst-case outcome. The failure modes are
// constrained:
//   1. P2002 on the org's email — caught at step 1, no writes
//      after, AppError(409) is thrown.
//   2. FK / connectivity / RLS rejection on the user row — fails
//      the whole request; the org is left behind. The next
//      attempt with a different email succeeds.
//   3. RLS rejection on the audit log — fails the whole request;
//      the org + user are left behind. The next attempt with a
//      different email succeeds.
// The cost of an orphaned org is low (it's a PENDING org with no
// users and no audit row) and can be cleaned by a follow-up
// housekeeping task. The cost of dropping the audit guarantee
// altogether would be higher — the audit log is the compliance
// story. A future migration to a non-pgbouncer connection pool
// (T5.4) is the right time to wrap this in a real transaction.

/**
 * Create an organization and its first admin user, with one
 * audit log row recording the create.
 *
 * @param {import("@prisma/client").PrismaClient} db
 *   A Prisma client. The route handler passes `prisma`; tests
 *   may pass any other client.
 * @param {{ name: string, type: "HOSPITAL"|"VENDOR", email: string,
 *           phone?: string, address?: string, city?: string,
 *           state?: string }} input
 *   The validated create payload (output of
 *   CreateOrganizationSchema.parse()).
 * @param {{ id: string|null, role: string, organizationId: string|null }} actor
 *   The authenticated caller. For T1.2 this is always a
 *   PLATFORM_ADMIN — the route's `requireRole("PLATFORM_ADMIN")`
 *   gate is the security boundary; the service trusts that input.
 *   `actor.organizationId` is used to scope the audit log row.
 * @returns {Promise<{ organization: object, user: object }>}
 *   The created organization and the first user row.
 * @throws {AppError} 409 if the email is already taken (P2002).
 * @throws  Any other Prisma error is re-thrown; the global
 *          errorHandler classifies it as 500.
 */
export async function createOrganization(db, input, actor) {
  // Pre-generate the org id and the first user id so they're
  // available for the user and audit-log writes that follow.
  const { randomUUID } = await import("node:crypto");
  const organizationId = randomUUID();
  const userId = randomUUID();
  // First user for a new org is its admin. Their
  // `supabaseUserId` is unknown at create time — the actual
  // Supabase auth user is created in a follow-up flow
  // (invitation / email signup) and a separate migration links
  // the row via `supabaseUserId`. The placeholder here is
  // deterministic from the new org id so the linking migration
  // can find and update it.
  const placeholderSupabaseId = `pending-${organizationId}`;

  // Step 1: create the organization. P2002 (unique email) is
  // caught here and surfaces as AppError(409) — see the catch
  // below.
  let organization;
  try {
    organization = await db.organization.create({
      data: {
        id: organizationId,
        name: input.name,
        type: input.type,
        email: input.email,
        phone: input.phone,
        address: input.address,
        city: input.city,
        state: input.state,
        // status: PENDING_VERIFICATION is the Prisma default. We
        // rely on it here so a future schema change to the default
        // only has to touch one place.
      },
      select: {
        id: true,
        name: true,
        type: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        throw new AppError(409, "An organization with that email already exists");
      }
    }
    throw err;
  }

  // Step 2: create the first admin user. FK is to the org we
  // just created. On failure here, the org row is orphaned —
  // see the module header for the cost analysis.
  const user = await db.user.create({
    data: {
      id: userId,
      supabaseUserId: placeholderSupabaseId,
      organizationId: organization.id,
      fullName: input.name, // placeholder; replaced on first login
      email: input.email,
      role: "ORG_ADMIN",
      isActive: true,
    },
    select: {
      id: true,
      organizationId: true,
      role: true,
      email: true,
    },
  });

  // Step 3: write the audit log row. The audit's
  // `organizationId` is the *actor's* tenant context (RLS
  // enforces this with `WITH CHECK (organizationId =
  // current_org_id())` — handoff §4.13). The new org's id lives
  // in `entityId` and `metadata.createdOrgId` for traceability.
  await db.auditLog.create({
    data: {
      organizationId: actor?.organizationId ?? null,
      userId: actor?.id ?? null,
      action: "create",
      entityType: "organization",
      entityId: organization.id,
      metadata: {
        createdOrgId: organization.id,
        createdOrgType: input.type,
        actorRole: actor?.role ?? "PLATFORM_ADMIN",
      },
    },
    select: { id: true },
  });

  return { organization, user };
}
