import { describe, expect, it } from "vitest";
import { buildShareVariables, renderShareMessage, resourceLink, resourceSlug, sampleShareVariables, unknownShareVariables, type ShareResource } from "./message";

const SITE = "https://academy.example/";
const demo: ShareResource = { id: "1", title: "Demo class", slug: "demo-class-ab12cd", url: "https://youtu.be/dQw4w9WgXcQ" };
const pdf: ShareResource = { id: "2", title: "Curriculum PDF", slug: "curriculum-pdf-ef34gh", url: "https://drive.google.com/file/d/abcdefghijk/view" };

describe("share message rendering", () => {
  it("fills candidate, course and resource variables", () => {
    const vars = buildShareVariables({
      siteUrl: SITE,
      businessName: "Example Academy",
      senderName: "Sam",
      candidate: { full_name: "  Asha  Rao " },
      course: { title: "Data Cloud", slug: "data-cloud", published: true },
      resources: [demo, pdf],
    });
    const body = "Hi {{first_name}},\n\nDemo for {{ course_title }}:\n{{resource_links}}\n\nCourse: {{course_url}}\nFirst: {{demo_url}}\n{{sender_name}}, {{business_name}}{{unknown}}";
    expect(renderShareMessage(body, vars)).toBe(
      [
        "Hi Asha,",
        "",
        "Demo for Data Cloud:",
        "• Demo class: https://academy.example/r/demo-class-ab12cd",
        "• Curriculum PDF: https://academy.example/r/curriculum-pdf-ef34gh",
        "",
        "Course: https://academy.example/courses/data-cloud",
        "First: https://academy.example/r/demo-class-ab12cd",
        "Sam, Example Academy",
      ].join("\n"),
    );
  });

  it("uses original links in direct mode and sensible fallbacks without a candidate or course", () => {
    const vars = buildShareVariables({ siteUrl: SITE, businessName: "X", senderName: "", candidate: null, course: null, resources: [demo], linkMode: "direct" });
    expect(vars.first_name).toBe("there");
    expect(vars.candidate_name).toBe("");
    expect(vars.course_url).toBe("https://academy.example/courses");
    expect(vars.resource_links).toBe("• Demo class: https://youtu.be/dQw4w9WgXcQ");
    expect(resourceLink(demo, SITE, "page")).toBe("https://academy.example/r/demo-class-ab12cd");
  });

  it("links to the course list when the course is not published", () => {
    const vars = buildShareVariables({ siteUrl: SITE, businessName: "X", senderName: "", candidate: null, course: { title: "Draft", slug: "draft", published: false }, resources: [] });
    expect(vars.course_url).toBe("https://academy.example/courses");
    expect(vars.demo_url).toBe("https://academy.example/courses");
  });

  it("collapses blank lines left by empty variables", () => {
    expect(renderShareMessage("Hi {{candidate_name}}  \n\n\n\n{{x}}\n\nBye", {})).toBe("Hi\n\nBye");
  });

  it("reports unknown variables and builds samples", () => {
    expect(unknownShareVariables("{{first_name}} {{fee}}", "{{ Batch_Start }}")).toEqual(["fee", "batch_start"]);
    expect(sampleShareVariables({ first_name: "Ravi" }).first_name).toBe("Ravi");
  });
});

describe("resourceSlug", () => {
  it("makes a URL-safe slug with a random suffix", () => {
    expect(resourceSlug("Démo: Salesforce Admin (Part 1)!", "AB12cd")).toBe("demo-salesforce-admin-part-1-ab12cd");
    expect(resourceSlug("!!!", "zz9")).toBe("resource-zz9");
    expect(resourceSlug("x".repeat(100), "q").length).toBeLessThanOrEqual(62);
  });
});
