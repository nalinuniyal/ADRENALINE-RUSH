import { describe, expect, it } from "vitest";
import { resourceSchema, shareSchema, sharingSettingsSchema } from "./resources";

const base = {
  title: "Demo class",
  type: "demo_video",
  url: "https://youtu.be/dQw4w9WgXcQ",
  description: "",
  thumbnailUrl: "",
  visibility: "shareable",
  isActive: true,
  accessInstructions: "",
  expiresOn: "",
  courseIds: [],
};

describe("resourceSchema", () => {
  it("turns blanks into nulls and de-duplicates courses", () => {
    const id = "6f1c2f8e-6d5a-4c1b-9e8f-0a1b2c3d4e5f";
    const v = resourceSchema.parse({ ...base, courseIds: [id, id] });
    expect(v).toMatchObject({ description: null, thumbnailUrl: null, expiresOn: null, courseIds: [id] });
  });

  it.each(["http://example.com", "javascript:alert(1)", "https://exa mple.com", "", "ftp://x"])("rejects link %s", (url) => {
    expect(resourceSchema.safeParse({ ...base, url }).success).toBe(false);
  });

  it("rejects unknown types and visibilities", () => {
    expect(resourceSchema.safeParse({ ...base, type: "malware" }).success).toBe(false);
    expect(resourceSchema.safeParse({ ...base, visibility: "public" }).success).toBe(false);
  });
});

describe("shareSchema", () => {
  const share = { candidateIds: [], resourceIds: ["6f1c2f8e-6d5a-4c1b-9e8f-0a1b2c3d4e5f"], templateId: "", courseId: "", linkMode: "page", subject: "", body: "Hi", method: "copy_message" };
  it("accepts a minimal share and normalises empty ids", () => {
    expect(shareSchema.parse(share)).toMatchObject({ templateId: null, courseId: null, markDemoShared: false });
  });
  it("needs a resource and limits bulk size", () => {
    expect(shareSchema.safeParse({ ...share, resourceIds: [] }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => `6f1c2f8e-6d5a-4c1b-9e8f-${String(i).padStart(12, "0")}`);
    expect(shareSchema.safeParse({ ...share, candidateIds: many }).success).toBe(false);
    expect(shareSchema.safeParse({ ...share, method: "sms" }).success).toBe(false);
  });
});

describe("sharingSettingsSchema", () => {
  it("accepts 91 and +91, rejects junk", () => {
    expect(sharingSettingsSchema.parse({ whatsappCountryCode: "+91" }).whatsappCountryCode).toBe("91");
    expect(sharingSettingsSchema.parse({ whatsappCountryCode: " 44 " }).whatsappCountryCode).toBe("44");
    for (const bad of ["0", "+", "12345", "91a", ""]) expect(sharingSettingsSchema.safeParse({ whatsappCountryCode: bad }).success).toBe(false);
  });
});
