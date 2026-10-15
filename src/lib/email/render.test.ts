import { describe, expect, it } from "vitest";
import { contrastText, renderEmail, renderSubject, resolveUrl, safeAccent, toDesign } from "./render";
import { sanitizeEmailHtml } from "./sanitize";
import { buildVariables, sampleVariables, substitute } from "./variables";

const SITE = "https://academy.example";

describe("substitute", () => {
  it("replaces known variables, blanks unknown ones and escapes in html mode", () => {
    const vars = { candidate_name: `<b>"Tom" & Jerry</b>`, first_name: "Tom" };
    expect(substitute("Hi {{ first_name }} {{nope}}!", vars)).toBe("Hi Tom !");
    expect(substitute("{{candidate_name}}", vars, "html")).toBe("&lt;b&gt;&quot;Tom&quot; &amp; Jerry&lt;/b&gt;");
    expect(substitute("{{x}}", { x: "a\nb" }, "html")).toBe("a<br>b");
  });
});

describe("renderEmail (structured design)", () => {
  const base = {
    subject: "Booked: {{course_title}}",
    preheader: "Thanks {{first_name}}",
    design: {
      heading: "Hello {{first_name}}",
      body: "Para one line 1\nline 2\n\nPara two with {{candidate_name}}",
      button_label: "Open",
      button_url: "{{course_url}}",
      footer_text: "Sent by {{business_name}}",
      accent_color: "#ffcc00",
      header_image_url: "/media/3f1c1c1c-1111-4111-8111-111111111111",
    },
  };

  it("renders an escaped, table-based email with absolute links and a text part", () => {
    const vars = { ...sampleVariables("candidate"), candidate_name: "<script>alert(1)</script>", first_name: "Ann", course_title: "MC <Pro>", course_url: `${SITE}/courses/mc`, business_name: "AR" };
    const out = renderEmail(base, vars, { siteUrl: SITE });
    expect(out.subject).toBe("Booked: MC <Pro>");
    expect(out.html).toContain('role="presentation"');
    expect(out.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("<p style=\"margin:0 0 16px 0;\">Para one line 1<br>line 2</p>");
    expect(out.html).toContain(`src="${SITE}/media/3f1c1c1c-1111-4111-8111-111111111111"`);
    expect(out.html).toContain(`href="${SITE}/courses/mc"`);
    expect(out.html).toContain("Thanks Ann");
    // Light accent gets dark button text.
    expect(out.html).toContain("color:#181818");
    expect(out.text).toContain("Hello Ann");
    expect(out.text).toContain(`Open: ${SITE}/courses/mc`);
    expect(out.text).toContain("--\nSent by AR");
    // The text part is plain text: values appear literally, never as markup.
    expect(out.text).not.toContain("<p");
  });

  it("drops the button when the link is not a safe URL (even from a variable)", () => {
    const out = renderEmail({ ...base, design: { ...base.design, button_url: "{{candidate_name}}" } }, { candidate_name: "javascript:alert(1)" }, { siteUrl: SITE });
    expect(out.html).not.toMatch(/href="javascript:/i);
    expect(out.html).not.toContain(">Open</a>");
  });

  it("falls back to the default accent and omits empty sections", () => {
    const out = renderEmail({ subject: "S", design: { body: "Only body", accent_color: "red" } }, {}, { siteUrl: SITE });
    expect(out.html).toContain("#0176d3");
    expect(out.html).not.toContain("<img");
    expect(out.html).not.toContain("<h1");
  });
});

describe("renderEmail (custom HTML)", () => {
  it("sanitises admin HTML and escapes variable values", () => {
    const out = renderEmail(
      {
        subject: "S",
        design: {},
        use_custom_html: true,
        custom_html: `<p onclick="x()">Hi {{candidate_name}}</p><script>bad()</script><a href="javascript:evil()">x</a><a href="{{course_url}}">course</a>`,
      },
      { candidate_name: "<img src=x onerror=alert(1)>", course_url: `${SITE}/c?a=1&b=2` },
      { siteUrl: SITE },
    );
    expect(out.html).not.toMatch(/onclick|<img|<script|javascript:/i);
    expect(out.html).toContain("&lt;img src=x");
    expect(out.html).toContain(`href="${SITE}/c?a=1&amp;b=2"`);
    expect(out.html).toMatch(/^<!doctype html>/);
    expect(out.text).toContain("course (");
  });
});

describe("helpers", () => {
  it("strips header-breaking characters from subjects", () => {
    expect(renderSubject("Hi\r\nBcc: x@y.z {{n}}", { n: "A\nB" })).toBe("Hi Bcc: x@y.z A B");
    expect(renderSubject("{{missing}}", {})).toBe("(no subject)");
  });
  it("resolves URLs safely", () => {
    expect(resolveUrl("/x", `${SITE}/`)).toBe(`${SITE}/x`);
    expect(resolveUrl("//evil.example/x", SITE)).toBeNull();
    expect(resolveUrl("javascript:alert(1)", SITE)).toBeNull();
    expect(resolveUrl("mailto:a@b.co", SITE)).toBeNull();
    expect(resolveUrl("mailto:a@b.co", SITE, true)).toBe("mailto:a@b.co");
    expect(resolveUrl("https://ok.example/a", SITE)).toBe("https://ok.example/a");
  });
  it("validates colours and picks readable text", () => {
    expect(safeAccent("#ABCDEF")).toBe("#abcdef");
    expect(safeAccent("url(x)")).toBe("#0176d3");
    expect(contrastText("#032d60")).toBe("#ffffff");
    expect(contrastText("#ffffff")).toBe("#181818");
  });
  it("coerces stored design json", () => {
    expect(toDesign({ heading: "H", body: 3, extra: "x" })).toEqual({ heading: "H" });
    expect(toDesign(null)).toEqual({});
  });
});

describe("buildVariables", () => {
  const src = {
    siteUrl: `${SITE}/`,
    businessName: "AR",
    candidate: { id: "c1", full_name: "Priya  Sharma", email: "p@example.test", phone: "+91 1", city: "Pune", total_experience_years: 4 },
    course: { title: "MCP", slug: "mcp", demo_url: null },
    answers: { goal: { label: "Your goal", value: "Get a job" }, langs: { label: "Languages", value: ["A", "B"] }, ok: { label: "Agree", value: true } },
  };
  it("fills team-only values only for team emails", () => {
    const team = buildVariables(src, "team");
    expect(team.first_name).toBe("Priya");
    expect(team.course_url).toBe(`${SITE}/courses/mcp`);
    expect(team.demo_url).toBe(`${SITE}/courses/mcp`);
    expect(team.candidate_admin_url).toBe(`${SITE}/admin/candidates/c1`);
    expect(team.registration_answers).toBe("City: Pune\nTotal experience (years): 4\nYour goal: Get a job\nLanguages: A, B\nAgree: Yes");
    const cand = buildVariables(src, "candidate");
    expect(cand.registration_answers).toBe("");
    expect(cand.candidate_admin_url).toBe("");
  });
});

describe("sanitizeEmailHtml", () => {
  it("removes active content in its many spellings", () => {
    const dirty = [
      "<scr<script>x</script>ipt>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "<img/onerror=alert(1) src=x>",
      '<a href="  JaVaScRiPt:alert(1)">a</a>',
      '<a href="jav&#x61;script:alert(1)">b</a>',
      '<a href="java&#10;script:alert(1)">c</a>',
      '<a href="data:text/html;base64,xx">d</a>',
      '<iframe src="https://x"></iframe>',
      '<form action="https://x"><input name=a></form>',
      '<div style="width:expression(alert(1))">e</div>',
      "<svg><script>alert(1)</script></svg>",
      '<meta http-equiv="refresh" content="0;url=https://x">',
    ].join("");
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toMatch(/<script|onerror|javascript:|jav&#x61;script|data:text|<iframe|<form|<input|expression\(|<svg|<meta/i);
  });
  it("keeps normal email markup and data: images", () => {
    const ok = '<table role="presentation"><tr><td style="color:#333"><a href="https://x.example">Link</a><img src="data:image/png;base64,AAA" alt=""></td></tr></table>';
    expect(sanitizeEmailHtml(ok)).toBe(ok);
  });
});
