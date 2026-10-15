import { describe, expect, it } from "vitest";
import { buildReminderMessage } from "./reminder";

describe("fee reminder message", () => {
  const base = {
    candidateName: "Asha Example",
    businessName: "Test Academy",
    courseTitle: "Synthetic Course",
    installmentLabel: "Installment 2",
    duePaise: 500000,
    dueDate: "2026-10-01",
    outstandingPaise: 1500000,
    currency: "INR",
    today: "2026-10-15",
  };

  it("names the installment, due date and total, and asks for a reply without a link", () => {
    const m = buildReminderMessage(base);
    expect(m.subject).toBe("Fee reminder: Synthetic Course");
    expect(m.body).toContain("Hi Asha,");
    expect(m.body).toContain("Installment 2 of ₹5,000 for Synthetic Course was due on 1 Oct 2026.");
    expect(m.body).toContain("Total still payable: ₹15,000.");
    expect(m.body).toContain("Please reply");
  });

  it("includes the payment link when there is one and handles a whole-fee reminder", () => {
    const m = buildReminderMessage({ ...base, installmentLabel: null, dueDate: null, outstandingPaise: 500000, paymentUrl: "https://rzp.io/i/abc" });
    expect(m.body).toContain("the fee of ₹5,000 for Synthetic Course is pending.");
    expect(m.body).not.toContain("Total still payable");
    expect(m.body).toContain("https://rzp.io/i/abc");
  });
});
