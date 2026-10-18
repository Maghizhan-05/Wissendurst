import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { PaymentFlow } from "@/components/payment/payment-flow";
import { PaymentBadge } from "@/components/ui/badge";
import { requireProfile } from "@/lib/auth";
import { getMyRegistration } from "@/lib/data/registrations";
import { resolveEventUpiId } from "@/lib/data/events";
import { upiQrDataUrl, defaultUpiId } from "@/lib/payment";
import { formatINR } from "@/lib/utils";

export const metadata: Metadata = { title: "Payment" };

export default async function PaymentPage({ params }: PageProps<"/dashboard/payment/[id]">) {
  const { id } = await params;
  const [profile, registration] = await Promise.all([
    requireProfile(),
    getMyRegistration(id),
  ]);

  if (!registration) notFound();

  const { event } = registration;
  const note = `WD27 ${profile.participant_id} ${event.slug}`.slice(0, 40);
  const upiId = (await resolveEventUpiId(event)) ?? defaultUpiId();
  const qr = await upiQrDataUrl(registration.amount, note, upiId);
  const payee = process.env.NEXT_PUBLIC_UPI_PAYEE_NAME ?? "Wissendrust 27";
  const discount = event.registration_fee - registration.amount;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/dashboard/registrations"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to my events
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Complete your payment
          </h1>
          <p className="mt-1 text-sm text-muted">
            {event.title} · Participant{" "}
            <span className="font-mono text-foreground">{profile.participant_id}</span>
          </p>
        </div>
        <PaymentBadge status={registration.payment_status} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Pay panel */}
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-muted">Amount to pay</p>
            <div className="text-right">
              {discount > 0 && (
                <p className="text-sm text-muted line-through">
                  {formatINR(event.registration_fee)}
                </p>
              )}
              <p className="font-display text-3xl font-semibold text-foreground">
                {formatINR(registration.amount)}
              </p>
            </div>
          </div>
          {discount > 0 && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-success/12 px-2.5 py-0.5 text-xs font-medium text-success">
              Sibling discount applied — you saved {formatINR(discount)}
            </p>
          )}

          <div className="mt-6 flex flex-col items-center rounded-2xl border border-border bg-white p-5">
            <Image
              src={qr}
              alt="UPI payment QR code"
              width={240}
              height={240}
              unoptimized
              className="rounded-lg"
            />
            <p className="mt-3 text-center text-xs text-[#0b2528]">
              Scan with any UPI app
            </p>
          </div>

          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">UPI ID</dt>
              <dd className="font-mono text-foreground">{upiId}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Payee</dt>
              <dd className="text-foreground">{payee}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Reference note</dt>
              <dd className="font-mono text-xs text-foreground">{note}</dd>
            </div>
          </dl>

          <div className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted">
            <Info className="mt-0.5 size-4 shrink-0 text-brand" />
            <p>
              Pay the exact amount, then upload the screenshot showing the
              transaction/UTR number. Your spot is confirmed only after an
              organizer verifies the payment.
            </p>
          </div>
        </div>

        {/* Upload / verify panel */}
        <div>
          <PaymentFlow
            registrationId={registration.id}
            initialStatus={registration.payment_status}
          />
        </div>
      </div>
    </div>
  );
}
