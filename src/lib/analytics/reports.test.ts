import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { canExportReport, coursePerformanceCsv, enrollmentsCsv, leadSourcesCsv, leadsCsv, percent, refundsCsv, reportByKey } from "./reports";

describe("report permissions", () => {
  const def = (k: string) => reportByKey(k)!;
  it("needs reports.export, plus finance.view for money reports and CRM access for people reports", () => {
    expect(canExportReport(def("lead-sources"), ["reports.view"])).toBe(false);
    expect(canExportReport(def("lead-sources"), ["reports.export"])).toBe(true);
    expect(canExportReport(def("payments"), ["reports.export"])).toBe(false);
    expect(canExportReport(def("refunds"), ["reports.export", "finance.view"])).toBe(true);
    expect(canExportReport(def("leads"), ["reports.export"])).toBe(false);
    expect(canExportReport(def("leads"), ["reports.export", "candidates.view_assigned"])).toBe(true);
    expect(reportByKey("nope")).toBeNull();
  });
});

describe("CSV layouts", () => {
  it("percent handles zero", () => {
    expect(percent(1, 3)).toBe("33.3");
    expect(percent(0, 0)).toBe("");
  });

  it("course performance hides money columns without finance access", () => {
    const row = { title: "Course", status: "published", registrations: 4, demoBookings: 2, enrollments: 1, collections: 1500000, refunds: 50, revenue: 1499950, outstanding: 0, currency: "INR" };
    const [h1, r1] = parseCsv(coursePerformanceCsv([row], true));
    expect(h1).toContain("Net collections");
    expect(r1).toEqual(["Course", "published", "4", "2", "1", "25.0", "15000.00", "0.50", "14999.50", "0.00", "INR"]);
    const [h2, r2] = parseCsv(coursePerformanceCsv([row], false));
    expect(h2).not.toContain("Net collections");
    expect(r2).toHaveLength(6);
  });

  it("neutralises spreadsheet formulas in names and campaigns", () => {
    const csv = leadSourcesCsv([{ channel: "=HYPERLINK(\"x\")", medium: "+cmd", campaign: "@sum", leads: 2, demoBookings: 1, enrolled: 1 }]);
    const [, r] = parseCsv(csv);
    expect(r.slice(0, 3)).toEqual(["'=HYPERLINK(\"x\")", "'+cmd", "'@sum"]);
    expect(r[6]).toBe("50.0");
    const leads = parseCsv(leadsCsv([{ name: "-1+1", email: null, phone: "+91 90000 00000", status: "New", owner: "", source: null, utmSource: null, utmMedium: null, utmCampaign: null, city: null, company: null, createdAt: "1 Oct 2026" }]));
    expect(leads[1][0]).toBe("'-1+1");
    expect(leads[1][2]).toBe("'+91 90000 00000");
  });

  it("enrollments add fee columns only with finance access", () => {
    const row = { candidate: "A", email: null, course: "C", batch: "", status: "active", enrolledAt: "2026-10-01", finalFee: 3000000, netPaid: 1000000, outstanding: 2000000, currency: "INR" };
    expect(parseCsv(enrollmentsCsv([row], true))[1].slice(6)).toEqual(["30000.00", "10000.00", "20000.00", "INR"]);
    expect(parseCsv(enrollmentsCsv([row], false))[1]).toHaveLength(6);
  });

  it("refund amounts are plain numbers", () => {
    const [, r] = parseCsv(refundsCsv([{ refundedOn: "2026-10-02", candidate: "A", course: "C", receipt: "AR-2026-0001", amount: 200050, currency: "INR", method: "UPI", reason: "Changed batch", status: "completed", reference: null }]));
    expect(r[4]).toBe("2000.50");
    expect(r[8]).toBe("Paid out");
  });
});
