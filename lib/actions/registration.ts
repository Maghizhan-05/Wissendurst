"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { notifyRegistration } from "@/lib/email/notify";
import type { RegistrationRow } from "@/types/database";

export type ActionResult = { ok: false; error: string } | { ok: true };

const RPC_ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in to register.",
  EVENT_NOT_FOUND: "That event no longer exists.",
  NOT_LIVE: "Registration for this event hasn't opened yet — coming soon.",
  REGISTRATION_CLOSED: "Registration for this event is closed.",
  ALREADY_REGISTERED: "You're already registered for this event.",
  EVENT_FULL: "This event has reached capacity.",
};

function mapRpcError(message: string | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  for (const key of Object.keys(RPC_ERRORS)) {
    if (message.includes(key)) return RPC_ERRORS[key];
  }
  // Common setup problems get a clear, actionable message instead of a
  // generic one — these mean the DB functions/grants aren't in place.
  const m = message.toLowerCase();
  if (m.includes("could not find the function") || m.includes("schema cache")) {
    return "Registration isn't set up on the server yet (missing database function). Run supabase/migrations/0003_functions.sql on your Supabase project.";
  }
  if (m.includes("permission denied")) {
    return "The server denied the registration function. Re-run supabase/migrations/0003_functions.sql (it grants EXECUTE to authenticated users).";
  }
  // Surface the real reason rather than hiding it behind a generic popup.
  return `Registration failed: ${message}`;
}

/**
 * Registers the current user for an event via the capacity-safe RPC, then
 * routes to payment (paid events) or the registrations list (free events).
 */
export async function registerForEvent(formData: FormData): Promise<ActionResult> {
  const eventId = String(formData.get("event_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!eventId) return { ok: false, error: "Missing event." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/events/${slug}`);

  const { data, error } = await supabase.rpc("register_for_event", {
    p_event_id: eventId,
  });
  if (error) {
    // Log the full error so it also appears in the Vercel function logs.
    console.error("register_for_event failed:", error);
    return { ok: false, error: mapRpcError(error.message) };
  }

  // PostgREST may return the composite row as an object or a single-item array.
  const reg = (Array.isArray(data) ? data[0] : data) as RegistrationRow | null;
  if (!reg?.id) {
    return {
      ok: false,
      error: "Registration didn't complete. Please try again.",
    };
  }

  revalidatePath("/dashboard/registrations");
  revalidatePath(`/events/${slug}`);

  // Best-effort registration email (must run before redirect throws).
  try {
    await notifyRegistration(reg.id);
  } catch (e) {
    console.error("registration email failed:", e);
  }

  if (reg.payment_status === "verified") {
    // Free event — already confirmed.
    redirect("/dashboard/registrations?joined=1");
  }
  redirect(`/dashboard/payment/${reg.id}`);
}

/** Cancels the current user's still-unpaid registration. */
export async function cancelRegistration(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("registration_id") ?? "");
  if (!id) return { ok: false, error: "Missing registration." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_registration", {
    p_registration_id: id,
  });

  if (error) return { ok: false, error: "Could not cancel registration." };
  revalidatePath("/dashboard/registrations");
  return { ok: true };
}
