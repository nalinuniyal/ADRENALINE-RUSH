import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { IndianRupee } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { getPaymentSettings } from "@/lib/data/pay-links";
import { maskAccountNumber } from "@/lib/finance/upi";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PaymentDetailsForm } from "./payment-details-form";
import { QrUpload } from "./qr-upload";

export const metadata: Metadata = { title: "Payment details" };

export default function PaymentDetailsPage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[70vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <PaymentDetails />
    </Suspense>
  );
}

async function PaymentDetails() {
  const { access, denied } = await requireAccess(["finance.manage", "settings.manage"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const supabase = await createSupabaseServerClient();
  const settings = await getPaymentSettings(supabase, orgId);
  const canSeeNumber = access.permissions.includes("finance.view");
  const { data: fullNumber } = canSeeNumber ? await supabase.rpc("payment_settings_account_number", { p_org: orgId }) : { data: null };

  const header = (
    <PageHeader
      title="Payment details"
      icon={IndianRupee}
      color="green"
      crumbs={[{ label: "Settings", href: "/admin/settings" }, { label: "Payment details" }]}
      description="Your UPI ID and bank account, shown to students on their pay pages so they can pay you directly. Free: no gateway fees, money goes straight to your bank."
    />
  );
  if (!settings) {
    return (
      <>
        {header}
        <Alert tone="warning" title="Payment details are not set up yet">
          Run the latest supabase/setup.sql in the Supabase SQL Editor, then reload this page.
        </Alert>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-4">
        <PaymentDetailsForm
          initial={{
            upiVpa: settings.upiVpa ?? "",
            upiPayeeName: settings.upiPayeeName ?? access.organization.name,
            bankAccountHolder: settings.bankAccountHolder ?? "",
            bankAccountNumber: fullNumber ?? "",
            keepAccountNumber: !fullNumber && Boolean(settings.bankAccountLast4),
            bankIfsc: settings.bankIfsc ?? "",
            bankName: settings.bankName ?? "",
            bankBranch: settings.bankBranch ?? "",
            bankAccountType: settings.bankAccountType ?? "",
            instructions: settings.instructions ?? "",
            showOnPayPage: settings.showOnPayPage,
            showInReminders: settings.showInReminders,
            showOnCoursePages: settings.showOnCoursePages,
            confirmEmailEnabled: settings.confirmEmailEnabled,
            confirmEmailSubject: settings.confirmEmailSubject,
            confirmEmailBody: settings.confirmEmailBody,
          }}
          savedNumberMasked={settings.bankAccountLast4 ? maskAccountNumber(`0000${settings.bankAccountLast4}`) : null}
          businessName={access.organization.name}
          qrUrl={settings.upiQrMediaId ? `/media/${settings.upiQrMediaId}` : null}
        />
        <Card>
          <CardHeader>
            <CardTitle>Your own UPI QR image (optional)</CardTitle>
            <CardDescription>
              The pay page always draws a QR code with the exact amount. If you also want to offer the QR sticker from your bank or UPI app, upload a PNG or JPG
              (up to 1 MB). It cannot carry the amount, so students type it themselves.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QrUpload current={settings.upiQrMediaId ? `/media/${settings.upiQrMediaId}` : null} />
          </CardContent>
        </Card>
        <p className="text-xs text-muted">
          Students report payments on their pay page; you confirm them under{" "}
          <Link href="/admin/finance/verify" className="text-brand-700 hover:underline">
            Payments › To verify
          </Link>
          . Want payments confirmed automatically? Set up Razorpay (Settings › Integrations); it charges a fee per payment.
        </p>
      </div>
    </>
  );
}
