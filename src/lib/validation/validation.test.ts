import { describe, expect, it } from "vitest";
import { loginSchema, setupSchema, slugify } from "./auth";
import { organizationSettingsSchema } from "./settings";

const validSetup = {
  setupToken: "x".repeat(40),
  businessName: "Adrenaline Rush",
  businessSlug: "adrenaline-rush",
  fullName: "Test Owner",
  email: "Owner@Example.TEST ",
  password: "CorrectHorse42x",
  confirmPassword: "CorrectHorse42x",
};

describe("setupSchema", () => {
  it("accepts a valid setup and normalises email", () => {
    const r = setupSchema.parse(validSetup);
    expect(r.email).toBe("owner@example.test");
  });
  it.each([
    ["short password", { password: "Short1A", confirmPassword: "Short1A" }, "password"],
    ["no digit", { password: "NoDigitsHereAtAll", confirmPassword: "NoDigitsHereAtAll" }, "password"],
    ["mismatch", { confirmPassword: "Different42xYZ" }, "confirmPassword"],
    ["bad slug", { businessSlug: "Bad Slug!" }, "businessSlug"],
    ["bad email", { email: "not-an-email" }, "email"],
  ])("rejects %s", (_name, patch, field) => {
    const r = setupSchema.safeParse({ ...validSetup, ...patch });
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain(field);
  });
});

describe("slugify", () => {
  it.each([
    ["Adrenaline Rush", "adrenaline-rush"],
    ["  Marketing Cloud — Personalization!! ", "marketing-cloud-personalization"],
    ["Café Ünïcode", "cafe-unicode"],
    ["---", ""],
  ])("%s → %s", (input, out) => expect(slugify(input)).toBe(out));
});

describe("loginSchema", () => {
  it("trims and lower-cases email", () => {
    expect(loginSchema.parse({ email: " A@B.TEST ", password: "x" }).email).toBe("a@b.test");
  });
});

describe("organizationSettingsSchema", () => {
  const base = {
    name: "Adrenaline Rush",
    contactEmail: "",
    contactPhone: "",
    websiteUrl: "",
    logoUrl: "",
    timezone: "Asia/Kolkata",
    defaultCurrency: "inr",
    staffEnabled: false,
    instructorsEnabled: true,
  };
  it("turns empty optional fields into null and upper-cases currency", () => {
    const r = organizationSettingsSchema.parse(base);
    expect(r).toMatchObject({ contactEmail: null, websiteUrl: null, defaultCurrency: "INR" });
  });
  it.each([
    { timezone: "Mars/Base" },
    { defaultCurrency: "RUPEES" },
    { websiteUrl: "javascript:alert(1)" },
    { contactEmail: "nope" },
    { contactPhone: "call me" },
  ])("rejects %o", (patch) => {
    expect(organizationSettingsSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});
