import { describe, expect, it } from "vitest";
import {
  acceptInviteSchema,
  createInviteSchema,
  registerViaInviteSchema,
  transferOwnershipSchema,
  updateHouseholdSchema,
} from "./household";

describe("updateHouseholdSchema", () => {
  it("akzeptiert einen gültigen Namen", () => {
    expect(updateHouseholdSchema.safeParse({ name: "Vincenzos Haushalt", currency: "EUR" }).success).toBe(true);
  });

  it("lehnt einen leeren Namen ab", () => {
    expect(updateHouseholdSchema.safeParse({ name: "", currency: "EUR" }).success).toBe(false);
  });

  it("lehnt eine nicht unterstützte Währung ab", () => {
    expect(updateHouseholdSchema.safeParse({ name: "X", currency: "USD" }).success).toBe(false);
  });

  it("verwendet EUR als Default-Währung", () => {
    expect(updateHouseholdSchema.parse({ name: "X" }).currency).toBe("EUR");
  });
});

describe("createInviteSchema", () => {
  it("akzeptiert eine gültige E-Mail mit role MEMBER", () => {
    const result = createInviteSchema.safeParse({ email: "partner@example.com", role: "MEMBER" });
    expect(result.success).toBe(true);
  });

  it("lehnt role OWNER ab: Ownership darf nie per Invite vergeben werden", () => {
    const result = createInviteSchema.safeParse({ email: "partner@example.com", role: "OWNER" });
    expect(result.success).toBe(false);
  });

  it("verwendet MEMBER als Default-Rolle, wenn keine angegeben ist", () => {
    expect(createInviteSchema.parse({ email: "partner@example.com" }).role).toBe("MEMBER");
  });

  it("lehnt eine ungültige E-Mail ab", () => {
    expect(createInviteSchema.safeParse({ email: "nicht-valide" }).success).toBe(false);
  });

  it("normalisiert die E-Mail auf Kleinschreibung", () => {
    expect(createInviteSchema.parse({ email: "Partner@Example.COM" }).email).toBe("partner@example.com");
  });
});

describe("transferOwnershipSchema", () => {
  it("verlangt eine nicht-leere targetMemberId", () => {
    expect(transferOwnershipSchema.safeParse({ targetMemberId: "member-1" }).success).toBe(true);
    expect(transferOwnershipSchema.safeParse({ targetMemberId: "" }).success).toBe(false);
  });
});

describe("acceptInviteSchema", () => {
  it("verlangt einen nicht-leeren Token", () => {
    expect(acceptInviteSchema.safeParse({ token: "abc" }).success).toBe(true);
    expect(acceptInviteSchema.safeParse({ token: "" }).success).toBe(false);
  });
});

describe("registerViaInviteSchema", () => {
  it("akzeptiert eine vollständige gültige Eingabe", () => {
    const result = registerViaInviteSchema.safeParse({
      token: "abc",
      name: "Partner",
      email: "partner@example.com",
      password: "supersecure123",
    });
    expect(result.success).toBe(true);
  });

  it("lehnt ein zu kurzes Passwort ab", () => {
    const result = registerViaInviteSchema.safeParse({
      token: "abc",
      name: "Partner",
      email: "partner@example.com",
      password: "short",
    });
    expect(result.success).toBe(false);
  });

  it("lehnt einen fehlenden Token ab", () => {
    const result = registerViaInviteSchema.safeParse({
      token: "",
      name: "Partner",
      email: "partner@example.com",
      password: "supersecure123",
    });
    expect(result.success).toBe(false);
  });
});
