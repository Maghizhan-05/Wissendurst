import { createClient } from "@/lib/supabase/server";
import { queryError } from "@/lib/supabase/query-error";
import type { RegistrationState } from "@/lib/payment-intent";
import type {
  RegistrationRow,
  RegistrationWithEvent,
} from "@/types/database";

/**
 * Effective payment-intent state of the current user's registrations, keyed
 * by registration id (teammates follow their head; expiry is time-based).
 */
export async function getMyRegistrationStates(): Promise<
  Map<string, RegistrationState>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Map();

  const { data, error } = await supabase.rpc("my_registration_states");
  if (error) throw queryError("my_registration_states", error);
  return new Map(
    ((data ?? []) as RegistrationState[]).map((s) => [s.registration_id, s]),
  );
}

/**
 * Event ids the current user holds a live registration for — confirmed,
 * under review, rejected-awaiting-resubmission or a still-valid intent.
 * Cancelled rows and expired intents don't count (registering refreshes them).
 */
export async function getMyRegisteredEventIds(): Promise<Set<string>> {
  const states = await getMyRegistrationStates();
  const ids = new Set<string>();
  for (const s of states.values()) if (!s.reusable) ids.add(s.event_id);
  return ids;
}

export type RegistrationWithEventAndState = RegistrationWithEvent & {
  state: RegistrationState | null;
};

/** Current user's registrations with their event and intent state. */
export async function getMyRegistrations(): Promise<
  RegistrationWithEventAndState[]
> {
  const supabase = await createClient();
  const [{ data, error }, states] = await Promise.all([
    supabase
      .from("registrations")
      .select("*, event:events!registrations_event_id_fkey(*)")
      .order("registered_at", { ascending: false }),
    getMyRegistrationStates(),
  ]);
  if (error) throw queryError("getMyRegistrations", error);
  return ((data as RegistrationWithEvent[]) ?? []).map((r) => ({
    ...r,
    state: states.get(r.id) ?? null,
  }));
}

/** A single registration owned by the current user (RLS-scoped). */
export async function getMyRegistration(
  id: string,
): Promise<RegistrationWithEventAndState | null> {
  const supabase = await createClient();
  const [{ data, error }, states] = await Promise.all([
    supabase
      .from("registrations")
      .select("*, event:events!registrations_event_id_fkey(*)")
      .eq("id", id)
      .maybeSingle(),
    getMyRegistrationStates(),
  ]);
  // A failed query is an error (error page), never a "not found".
  if (error) throw queryError("getMyRegistration", error);
  if (!data) return null;
  const reg = data as RegistrationWithEvent;
  return { ...reg, state: states.get(reg.id) ?? null };
}

/** The current user's registration for a specific event, if any. */
export async function getMyRegistrationForEvent(
  eventId: string,
): Promise<(RegistrationRow & { state: RegistrationState | null }) | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data, error }, states] = await Promise.all([
    supabase
      .from("registrations")
      .select("*")
      .eq("event_id", eventId)
      .eq("profile_id", user.id)
      .maybeSingle(),
    getMyRegistrationStates(),
  ]);
  if (error) throw queryError("getMyRegistrationForEvent", error);
  if (!data) return null;
  const reg = data as RegistrationRow;
  return { ...reg, state: states.get(reg.id) ?? null };
}
