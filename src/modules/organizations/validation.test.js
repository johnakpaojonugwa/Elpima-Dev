import { describe, it, expect } from "vitest";
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
  OrganizationIdParamSchema,
} from "./validation.js";

describe("CreateOrganizationSchema", () => {
  describe("happy path", () => {
    it("accepts a valid hospital payload and applies defaults", () => {
      const input = {
        name: "St. Mercy General Hospital",
        type: "HOSPITAL",
        email: "contact@stmercy.example",
      };
      const result = CreateOrganizationSchema.parse(input);

      expect(result).toEqual({
        name: "St. Mercy General Hospital",
        type: "HOSPITAL",
        email: "contact@stmercy.example",
        status: "PENDING_VERIFICATION",
      });
    });

    it("accepts a valid vendor payload with optional contact fields", () => {
      const input = {
        name: "Acme Surgicals Ltd",
        type: "VENDOR",
        email: "sales@acmesurgicals.example",
        phone: "+2348012345678",
        address: "12 Industrial Way",
        city: "Lagos",
        state: "Lagos",
      };
      const result = CreateOrganizationSchema.parse(input);

      expect(result).toEqual({
        name: "Acme Surgicals Ltd",
        type: "VENDOR",
        email: "sales@acmesurgicals.example",
        phone: "+2348012345678",
        address: "12 Industrial Way",
        city: "Lagos",
        state: "Lagos",
        status: "PENDING_VERIFICATION",
      });
    });

    it("trims whitespace from string fields", () => {
      const input = {
        name: "  Trimmed Hospital  ",
        type: "HOSPITAL",
        email: "  hello@example.com  ",
      };
      const result = CreateOrganizationSchema.parse(input);

      expect(result.name).toBe("Trimmed Hospital");
      expect(result.email).toBe("hello@example.com");
    });
  });

  describe("rejections", () => {
    it("rejects an empty name", () => {
      const input = { name: "", type: "HOSPITAL", email: "a@b.co" };
      expect(() => CreateOrganizationSchema.parse(input)).toThrow();
    });

    it("rejects a missing name", () => {
      const input = { type: "HOSPITAL", email: "a@b.co" };
      expect(() => CreateOrganizationSchema.parse(input)).toThrow();
    });

    it("rejects a missing type", () => {
      const input = { name: "X", email: "a@b.co" };
      expect(() => CreateOrganizationSchema.parse(input)).toThrow();
    });

    it("rejects an unknown org type", () => {
      const input = { name: "X", type: "DISTRIBUTOR", email: "a@b.co" };
      expect(() => CreateOrganizationSchema.parse(input)).toThrow();
    });

    it("rejects an invalid email", () => {
      const input = { name: "X", type: "HOSPITAL", email: "not-an-email" };
      expect(() => CreateOrganizationSchema.parse(input)).toThrow();
    });

    it("rejects a missing email", () => {
      const input = { name: "X", type: "HOSPITAL" };
      expect(() => CreateOrganizationSchema.parse(input)).toThrow();
    });

    it("rejects extra fields on the payload (strict)", () => {
      const input = {
        name: "X",
        type: "HOSPITAL",
        email: "a@b.co",
        id: "injected-uuid",
      };
      expect(() => CreateOrganizationSchema.parse(input)).toThrow();
    });

    it("rejects a name longer than 200 characters", () => {
      const input = {
        name: "A".repeat(201),
        type: "HOSPITAL",
        email: "a@b.co",
      };
      expect(() => CreateOrganizationSchema.parse(input)).toThrow();
    });
  });
});

describe("UpdateOrganizationSchema", () => {
  it("accepts an empty object (no-op update)", () => {
    // Status changes are gated at the route level (PLATFORM_ADMIN only)
    // and not part of this schema. The route handler will reject
    // attempts to change `status` from a non-platform-admin caller.
    const result = UpdateOrganizationSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts a partial update of contact fields", () => {
    const input = { phone: "+2348099999999", city: "Abuja" };
    const result = UpdateOrganizationSchema.parse(input);
    expect(result).toEqual({ phone: "+2348099999999", city: "Abuja" });
  });

  it("rejects an attempt to change type via the update schema", () => {
    const input = { type: "VENDOR" };
    expect(() => UpdateOrganizationSchema.parse(input)).toThrow();
  });

  it("rejects an attempt to change status via the update schema", () => {
    const input = { status: "VERIFIED" };
    expect(() => UpdateOrganizationSchema.parse(input)).toThrow();
  });

  it("rejects an invalid email in a partial update", () => {
    const input = { email: "not-an-email" };
    expect(() => UpdateOrganizationSchema.parse(input)).toThrow();
  });

  it("rejects an empty name in a partial update", () => {
    const input = { name: "" };
    expect(() => UpdateOrganizationSchema.parse(input)).toThrow();
  });
});

describe("OrganizationIdParamSchema", () => {
  it("accepts a valid UUID", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const result = OrganizationIdParamSchema.parse({ id });
    expect(result.id).toBe(id);
  });

  it("rejects a non-UUID string", () => {
    expect(() =>
      OrganizationIdParamSchema.parse({ id: "not-a-uuid" })
    ).toThrow();
  });

  it("rejects a missing id", () => {
    expect(() => OrganizationIdParamSchema.parse({})).toThrow();
  });

  it("rejects a numeric id", () => {
    expect(() =>
      OrganizationIdParamSchema.parse({ id: 12345 })
    ).toThrow();
  });
});
