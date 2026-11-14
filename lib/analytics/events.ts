/**
 * Typed product events (D-024). Pure. Only these four custom events exist;
 * properties are limited to the public event slug/category and coarse team
 * information, re-validated by the sanitizer before send.
 */
import type { CustomEventName } from "./sanitize.ts";

export interface RegistrationEventProps {
  event_slug: string;
  event_category?: string;
  team: boolean;
  /** Coarse team size (1–10) for team registrations. */
  team_size?: number;
}

export interface CustomEventProps {
  consent_granted: Record<string, never>;
  consent_denied: Record<string, never>;
  registration_started: RegistrationEventProps;
  free_registration_confirmed: RegistrationEventProps;
}

export type TrackFn = <E extends CustomEventName>(event: E, props: CustomEventProps[E]) => void;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Builds registration props from public event fields (invalid fields omitted). */
export function registrationProps(input: {
  slug: string;
  category?: string | null;
  teamSize?: number | null;
}): RegistrationEventProps {
  const team = typeof input.teamSize === "number" && input.teamSize >= 2;
  return {
    event_slug: SLUG.test(input.slug) ? input.slug : "unknown",
    ...(input.category && SLUG.test(input.category) ? { event_category: input.category } : {}),
    team,
    ...(team ? { team_size: Math.min(Math.max(Math.round(input.teamSize as number), 2), 10) } : {}),
  };
}
