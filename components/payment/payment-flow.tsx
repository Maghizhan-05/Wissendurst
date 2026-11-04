"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { UploadCloud, ShieldCheck, TriangleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  analyzeScreenshot,
  confirmPayment,
} from "@/lib/actions/payment";
import {
  analyzeGeneralScreenshot,
  confirmGeneralPayment,
} from "@/lib/actions/general-registration";
import type { PaymentStatus } from "@/lib/constants";

type Step = "upload" | "confirm" | "done";

export function PaymentFlow({
  registrationId,
  initialStatus,
  kind = "event",
}: {
  /** Event registration id (ignored for General Registration). */
  registrationId: string;
  initialStatus: PaymentStatus;
  /** "general" pays the caller's General Registration intent. */
  kind?: "event" | "general";
}) {
  const general = kind === "general";
  const backHref = general ? "/general-registration" : "/dashboard/registrations";
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [lowConfidence, setLowConfidence] = useState(false);
  const [result, setResult] = useState<PaymentStatus | null>(
    ["under_review", "verified"].includes(initialStatus) ? initialStatus : null,
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  function handleAnalyze() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a payment screenshot first.");
      return;
    }
    const fd = new FormData();
    fd.append("registration_id", registrationId);
    fd.append("file", file);

    startTransition(async () => {
      const res = general ? await analyzeGeneralScreenshot(fd) : await analyzeScreenshot(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setRef(res.ref ?? "");
      setLowConfidence(res.confidence <= 0.7);
      setStep("confirm");
      if (!res.ref) {
        toast.message("We couldn't read the reference — please type it in.");
      }
    });
  }

  function handleConfirm() {
    if (ref.trim().length < 6) {
      toast.error("Enter a valid transaction / UTR number.");
      return;
    }
    const fd = new FormData();
    fd.append("registration_id", registrationId);
    fd.append("transaction_id", ref.trim());

    startTransition(async () => {
      const res = general ? await confirmGeneralPayment(fd) : await confirmPayment(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult(res.status);
      setStep("done");
      if (res.status === "duplicate") {
        toast.error("This transaction ID is already in use.");
      } else {
        toast.success("Payment submitted for review.");
        router.refresh();
      }
    });
  }

  // ── Terminal states ────────────────────────────────────────────
  if (result === "verified") {
    return (
      <StatusPanel
        tone="success"
        icon={<ShieldCheck className="size-6" />}
        title="Payment verified"
        body={
          general
            ? "Your General Registration is verified. Enrol in each included event to reserve your seat."
            : "Your spot is confirmed. See you at the event!"
        }
        cta={{ label: general ? "Choose my events" : "View my events", onClick: () => router.push(backHref) }}
      />
    );
  }
  if (step === "done" && result === "under_review") {
    return (
      <StatusPanel
        tone="info"
        icon={<Loader2 className="size-6" />}
        title="Submitted for review"
        body="An organizer will verify your payment shortly. You'll see the status update on your dashboard."
        cta={
          general
            ? { label: "Refresh status", onClick: () => router.refresh() }
            : { label: "Go to my events", onClick: () => router.push(backHref) }
        }
      />
    );
  }
  if (step === "done" && result === "duplicate") {
    return (
      <StatusPanel
        tone="alert"
        icon={<TriangleAlert className="size-6" />}
        title="Duplicate transaction ID"
        body="This transaction ID is already linked to another registration. If you believe this is a mistake, re-upload the correct screenshot or contact the organizers."
        cta={{ label: "Try again", onClick: () => { setStep("upload"); setResult(null); } }}
      />
    );
  }

  if (initialStatus === "under_review" && step === "upload") {
    return (
      <StatusPanel
        tone="info"
        icon={<Loader2 className="size-6" />}
        title="Awaiting verification"
        body="Your payment is under review. You can re-upload a screenshot if needed."
        cta={{ label: "Re-upload screenshot", onClick: () => setResult(null) }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Step: upload */}
      <div className={step === "confirm" ? "opacity-50" : ""}>
        <p className="text-sm font-medium text-foreground">
          1 · Upload your payment screenshot
        </p>
        <label
          htmlFor="screenshot"
          className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-2/50 px-6 py-8 text-center transition-colors hover:border-brand/50"
        >
          {preview ? (
            <span className="relative h-40 w-full max-w-xs overflow-hidden rounded-xl">
              <Image src={preview} alt="Screenshot preview" fill className="object-contain" unoptimized />
            </span>
          ) : (
            <>
              <UploadCloud className="size-8 text-brand" />
              <span className="mt-2 text-sm font-medium text-foreground">
                Click to choose an image
              </span>
              <span className="mt-1 text-xs text-muted">PNG, JPG or WebP · max 5 MB</span>
            </>
          )}
          <input
            id="screenshot"
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={onPick}
            disabled={step === "confirm"}
          />
        </label>
        {step === "upload" && (
          <Button
            className="mt-4 w-full"
            onClick={handleAnalyze}
            loading={pending}
          >
            Analyze screenshot
          </Button>
        )}
      </div>

      {/* Step: confirm */}
      {step === "confirm" && (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm font-medium text-foreground">
            2 · Confirm the transaction reference
          </p>
          {lowConfidence && (
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              We&rsquo;re not fully sure we read this correctly. Please check it
              against your payment app before submitting.
            </p>
          )}
          <div className="mt-3">
            <Field
              label="Transaction / UTR number"
              htmlFor="ref"
              hint="Usually a 12-digit UTR or a UPI reference number."
            >
              <Input
                id="ref"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="e.g. 401234567890"
                className="font-mono"
                autoFocus
              />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={handleConfirm} loading={pending} withArrow className="flex-1">
              Submit for verification
            </Button>
            <Button
              variant="secondary"
              onClick={() => setStep("upload")}
              disabled={pending}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPanel({
  tone,
  icon,
  title,
  body,
  cta,
}: {
  tone: "success" | "info" | "alert";
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: { label: string; onClick: () => void };
}) {
  const toneClasses = {
    success: "border-success/30 bg-success/10 text-success",
    info: "border-brand/30 bg-brand/10 text-brand",
    alert: "border-alert/30 bg-alert/10 text-alert",
  }[tone];
  return (
    <div className={`rounded-2xl border p-6 ${toneClasses}`}>
      <div className="flex items-center gap-3">
        {icon}
        <h3 className="font-display text-lg font-semibold text-foreground">
          {title}
        </h3>
      </div>
      <p className="mt-2 text-sm text-muted">{body}</p>
      <Button className="mt-5" variant="secondary" onClick={cta.onClick}>
        {cta.label}
      </Button>
    </div>
  );
}
