import "server-only";
import { createClient } from "@/lib/supabase/server";
import { defaultUpiId } from "@/lib/payment";

/**
 * Site-default event UPI. The protected database setting (0026) is the source
 * of truth — the database enforces that General Registration's UPI differs
 * from it — with the environment value only as a fallback before it is set.
 */
export async function getDefaultEventUpiId(): Promise<string> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("payment_destination_settings")
      .select("default_event_upi_id")
      .eq("id", 1)
      .maybeSingle();
    const v = (data as { default_event_upi_id: string | null } | null)?.default_event_upi_id;
    if (v && v.trim()) return v.trim();
  } catch {
    /* fall through */
  }
  return defaultUpiId();
}
