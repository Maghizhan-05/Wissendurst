import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  EventRow,
  GeneralRegistrationEventRow,
  GeneralRegistrationRow,
  GeneralRegistrationSettingsRow,
  ProfileRow,
} from "@/types/database";

const CLOSED: GeneralRegistrationSettingsRow = {
  id: 1,
  enabled: false,
  fee: 0,
  upi_id: null,
  payee_name: "",
  description: "",
  instructions: "",
  updated_at: "",
  updated_by: null,
};

/** Settings singleton; treated as closed if it can't be read. */
export async function getGeneralRegistrationSettings(): Promise<GeneralRegistrationSettingsRow> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("general_registration_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return (data as GeneralRegistrationSettingsRow) ?? CLOSED;
}

/** Whether participants can start General Registration right now. */
export function isGeneralRegistrationOpen(s: GeneralRegistrationSettingsRow): boolean {
  return s.enabled && s.fee > 0 && Boolean(s.upi_id);
}

/** Non-archived events included in General Registration. */
export async function getCoveredEvents(): Promise<EventRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("general_registration_covered", true)
    .is("archived_at", null)
    .order("event_date", { ascending: true, nullsFirst: false })
    .order("title");
  return (data as EventRow[]) ?? [];
}

/** The signed-in participant's General Registration record (RLS: own row). */
export async function getMyGeneralRegistration(): Promise<GeneralRegistrationRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("general_registrations")
    .select("*")
    .eq("profile_id", user.id)
    .maybeSingle();
  return (data as GeneralRegistrationRow) ?? null;
}

type GrProfile = Pick<
  ProfileRow,
  "id" | "participant_id" | "full_name" | "email" | "phone" | "college"
>;
export type GeneralRegistrationAdminRow = GeneralRegistrationRow & { profile: GrProfile };

const PROFILE_COLS = "profile:profiles!profile_id(id,participant_id,full_name,email,phone,college)";

/** Admin list (payments scope via RLS), review queue first. */
export async function listGeneralRegistrations(): Promise<GeneralRegistrationAdminRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("general_registrations")
    .select(`*, ${PROFILE_COLS}`)
    .order("updated_at", { ascending: false });
  const rows = (data as GeneralRegistrationAdminRow[]) ?? [];
  const rank: Record<string, number> = { duplicate: 0, under_review: 1, uploaded: 2 };
  return rows.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
}

export async function getGeneralRegistrationAdmin(id: string): Promise<{
  record: GeneralRegistrationAdminRow;
  audit: GeneralRegistrationEventRow[];
  idHistory: { action: string; participant_id: string; created_at: string; reason: string | null }[];
} | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("general_registrations")
    .select(`*, ${PROFILE_COLS}`)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const record = data as GeneralRegistrationAdminRow;
  const [{ data: audit }, { data: hist }] = await Promise.all([
    supabase
      .from("general_registration_payment_events")
      .select("*")
      .eq("general_registration_id", id)
      .order("created_at", { ascending: true }),
    // Readable by signups admins (0021); empty for payments-only admins.
    supabase
      .from("participant_id_history")
      .select("action, participant_id, created_at, reason")
      .eq("profile_id", record.profile_id)
      .order("created_at", { ascending: true }),
  ]);
  return {
    record,
    audit: (audit as GeneralRegistrationEventRow[]) ?? [],
    idHistory: (hist as { action: string; participant_id: string; created_at: string; reason: string | null }[]) ?? [],
  };
}

/** Events an admin can include (leaf, non-archived) plus any already covered. */
export async function getCoverageOptions(): Promise<
  Pick<EventRow, "id" | "title" | "slug" | "parent_event_id" | "archived_at" | "general_registration_covered" | "registration_fee" | "team_enabled">[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, title, slug, parent_event_id, archived_at, general_registration_covered, registration_fee, team_enabled")
    .order("title");
  const rows = (data ?? []) as Awaited<ReturnType<typeof getCoverageOptions>>;
  const parents = new Set(rows.map((r) => r.parent_event_id).filter(Boolean));
  return rows.filter(
    (r) => r.general_registration_covered || (!parents.has(r.id) && !r.archived_at),
  );
}
