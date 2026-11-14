"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { captureError } from "@/components/analytics/bridge";

/**
 * Error boundary for the public pages (D-025). Reports the caught render
 * error through the consent-gated analytics bridge — a no-op unless the
 * visitor accepted analytics and the page is an approved public route; the
 * message and stack are redacted before anything is sent.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error);
  }, [error]);

  return (
    <div className="flex min-h-[60svh] flex-col items-center justify-center px-5 text-center">
      <h1 className="font-display text-3xl font-semibold text-foreground">Something went wrong</h1>
      <p className="mt-3 max-w-md text-muted">
        An unexpected error occurred. Please try again — if it keeps happening, contact the
        organizers.
      </p>
      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
