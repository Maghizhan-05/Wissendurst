/**
 * Hand-authored database types mirroring the Postgres schema in
 * supabase/migrations. Kept in sync manually (this project does not run
 * `supabase gen types`). Money is stored as INTEGER PAISE everywhere.
 */
import type {
  AdminScope,
  ApprovalStatus,
  EventCategory,
  PaymentStatus,
  RegistrationStatus,
  UserRole,
} from "@/lib/constants";

export interface ProfileRow {
  id: string; // = auth.users.id
  participant_id: string | null; // null until an admin approves the signup
  full_name: string;
  email: string;
  phone: string | null;
  college: string | null;
  course: string | null;
  year: string | null;
  profile_photo: string | null;
  role: UserRole;
  approval_status: ApprovalStatus;
  id_card_path: string | null;
  approved_by: string | null;
  approved_at: string | null;
  is_super_admin: boolean;
  admin_scopes: AdminScope[];
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  parent_event_id: string | null; // null = top-level event; set = sub-event
  slug: string;
  title: string;
  short_description: string;
  description: string;
  category: EventCategory;
  hero_image: string | null;
  thumbnail_image: string | null;
  rules: string[]; // jsonb array of rule lines
  eligibility: string | null;
  registration_fee: number; // paise
  venue: string | null;
  event_date: string | null; // date (YYYY-MM-DD)
  start_time: string | null; // time
  end_time: string | null; // time
  max_participants: number | null; // null = unlimited
  registration_open: boolean;
  featured: boolean;
  is_live: boolean; // false = "Coming soon" (locked), no registration
  upi_id: string | null; // per-event UPI; resolved leaf-first up the tree
  discount_enabled: boolean; // sibling discount on this broader event
  discount_amount: number; // paise off a sibling sub-event once one is paid
  team_enabled: boolean; // registration happens as a team
  team_min: number; // smallest team size (head included)
  team_max: number; // largest team size (head included)
  team_fee: number; // paise — flat fee for a team of 2+ (lone = registration_fee)
  created_at: string;
  updated_at: string;
}

export interface RegistrationRow {
  id: string;
  profile_id: string;
  event_id: string;
  registration_status: RegistrationStatus;
  payment_status: PaymentStatus;
  transaction_id: string | null;
  duplicate_of: string | null; // registration id that first used this txn
  payment_screenshot: string | null; // storage path
  ocr_raw_text: string | null;
  ocr_confidence: number | null;
  amount: number; // paise
  team_id: string | null; // set when this registration is part of a team
  is_team_head: boolean; // the member who registered & pays for the team
  registered_at: string;
  verified_at: string | null;
  verified_by: string | null;
  updated_at: string;
}

export interface PaymentEventRow {
  id: string;
  registration_id: string;
  actor_id: string | null;
  action: string;
  from_status: PaymentStatus | null;
  to_status: PaymentStatus | null;
  note: string | null;
  created_at: string;
}

/** Joined shapes returned by queries. */
export interface RegistrationWithEvent extends RegistrationRow {
  event: EventRow;
}

export interface RegistrationWithEventAndProfile extends RegistrationRow {
  event: Pick<EventRow, "id" | "slug" | "title" | "registration_fee">;
  profile: Pick<
    ProfileRow,
    "id" | "participant_id" | "full_name" | "email" | "phone"
  >;
}
