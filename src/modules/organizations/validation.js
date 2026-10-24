import { z } from "zod";

// =====================================================================
// Organizations module — request validation schemas
// =====================================================================
//
// All HTTP input that flows into the organizations service MUST pass
// through one of these schemas. The route handler's only job, with
// respect to input, is `parse()` and forward the result. Anything
// that fails parsing surfaces as a 400 via the global errorHandler,
// which already classifies ZodError and includes a sanitized
// `fieldErrors` map in the response.
//
// Matches the Prisma `Organization` model:
//   - name        String
//   - type        OrgType     (HOSPITAL | VENDOR)
//   - status      OrgStatus   default PENDING_VERIFICATION
//   - email       String @unique
//   - phone       String?
//   - address     String?
//   - city        String?
//   - state       String?
//
// Field-level invariants (separate from the role gate at the route):
//   - `type` is immutable on update (a hospital does not become a
//     vendor). Status transitions are handled by a separate
//     PLATFORM_ADMIN-only route so the audit log row carries the
//     actor's intent; this schema deliberately excludes both
//     fields from update.
//   - String fields are trimmed on parse so a frontend that sends
//     "  Hospital  " doesn't end up with leading whitespace in the
//     unique-email index.
//   - `.strict()` rejects unknown keys — including a client trying
//     to inject `id` or `organizationId` into the create payload.
//   - Email is validated syntactically by zod; uniqueness is the
//     DB's job (Prisma's `@unique`) and surfaces as a P2002 from
//     the global errorHandler as a 500 with a sanitized message.

// -- Field max-lengths (kept in one place so the column types in
//    schema.prisma can be cross-checked) -----------------------------
const MAX_NAME = 200;
const MAX_EMAIL = 254; // RFC 5321 SMTP path length
const MAX_PHONE = 40;
const MAX_ADDRESS = 500;
const MAX_CITY = 100;
const MAX_STATE = 100;

// -- Atoms ------------------------------------------------------------

const OrgTypeEnum = z.enum(["HOSPITAL", "VENDOR"]);

const OrgStatusEnum = z.enum([
  "PENDING_VERIFICATION",
  "VERIFIED",
  "SUSPENDED",
  "REJECTED",
]);

const orgName = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(MAX_NAME, `name must be ${MAX_NAME} characters or fewer`);

const orgEmail = z
  .string()
  .trim()
  .email("invalid email")
  .max(MAX_EMAIL, `email must be ${MAX_EMAIL} characters or fewer`);

// An optional, trimmed, length-bounded text field. Empty strings
// normalize to `undefined` so the DB's `NULL` semantics stay
// predictable — a field "cleared" in the UI is `undefined`, not "".
function optionalText(maxLength) {
  return z
    .string()
    .trim()
    .max(maxLength, `must be ${maxLength} characters or fewer`)
    .optional()
    .transform((fieldValue) => (fieldValue === undefined || fieldValue === "" ? undefined : fieldValue));
}

// -- Public schemas ---------------------------------------------------

export const CreateOrganizationSchema = z
  .object({
    name: orgName,
    type: OrgTypeEnum,
    email: orgEmail,
    phone: optionalText(MAX_PHONE),
    address: optionalText(MAX_ADDRESS),
    city: optionalText(MAX_CITY),
    state: optionalText(MAX_STATE),
    // The Prisma default is PENDING_VERIFICATION. Accepting the
    // field but ignoring it on the create path would be a silent
    // footgun, so the schema accepts it as a no-op transform —
    // caller-supplied status is discarded, the default applies.
    // Kept in the schema for forward-compat with an internal
    // bootstrap path that creates a pre-verified org (out of
    // scope here, gated behind a separate auth context).
    status: OrgStatusEnum.optional(),
  })
  .strict()
  .transform((payload) => ({ ...payload, status: "PENDING_VERIFICATION" }));

// Update schema: every field optional. `type` and `status` are
// deliberately absent — type is immutable for a tenant, and status
// transitions are handled by a separate PLATFORM_ADMIN-only route
// so the audit log row can carry the actor's intent.
//
// An empty object is allowed (a no-op update is valid); the route
// handler decides whether a no-op is meaningful for the caller.
export const UpdateOrganizationSchema = z
  .object({
    name: orgName.optional(),
    email: orgEmail.optional(),
    phone: optionalText(MAX_PHONE),
    address: optionalText(MAX_ADDRESS),
    city: optionalText(MAX_CITY),
    state: optionalText(MAX_STATE),
  })
  .strict();

// UUID-only path parameter. The `id` is the public UUID; the
// server never accepts a tenant's slug or a numeric id.
export const OrganizationIdParameterSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const OrganizationIdParamSchema = OrganizationIdParameterSchema;
