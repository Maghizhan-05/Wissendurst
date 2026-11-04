"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startGeneralRegistration, type GrActionState } from "@/lib/actions/general-registration";
import { formatINR } from "@/lib/utils";

export function StartGeneralRegistrationButton({ fee }: { fee: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<GrActionState, FormData>(
    async () => startGeneralRegistration(),
    null,
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
    else if (state && !state.ok) toast.error(state.error);
  }, [state, router]);
  return (
    <form action={action}>
      <Button type="submit" size="lg" loading={pending} withArrow>
        Start General Registration — {formatINR(fee)}
      </Button>
    </form>
  );
}
