import { z } from "zod";
import { EVENT_CATEGORIES } from "@/lib/constants";

const timeOrEmpty = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
  .or(z.literal(""));

export const eventSchema = z.object({
  title: z.string().trim().min(3, "Title is required").max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only")
    .min(3)
    .max(60),
  category: z.enum(EVENT_CATEGORIES),
  short_description: z.string().trim().min(5, "Add a short description").max(180),
  description: z.string().trim().max(5000).optional().default(""),
  eligibility: z.string().trim().max(300).optional().default(""),
  venue: z.string().trim().max(160).optional().default(""),
  // Rupees in the form; converted to paise before persisting.
  registration_fee_rupees: z.coerce
    .number()
    .int("Whole rupees only")
    .min(0, "Fee can't be negative")
    .max(1_000_000),
  event_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .or(z.literal("")),
  start_time: timeOrEmpty,
  end_time: timeOrEmpty,
  max_participants: z.coerce.number().int().min(0).max(100000).optional(),
  rules: z.string().optional().default(""), // newline-separated in the form
  hero_image: z.string().trim().url().or(z.literal("")).optional().default(""),
  thumbnail_image: z.string().trim().url().or(z.literal("")).optional().default(""),
  registration_open: z.coerce.boolean().optional().default(true),
  featured: z.coerce.boolean().optional().default(false),
  is_live: z.coerce.boolean().optional().default(false),
  // Empty string = top-level event; a uuid = this is a sub-event of that event.
  parent_event_id: z.string().uuid().or(z.literal("")).optional().default(""),
  // Per-event UPI id for the payment QR (any level). Empty = inherit / default.
  upi_id: z.string().trim().max(120).optional().default(""),
  // Team registration.
  team_enabled: z.coerce.boolean().optional().default(false),
  team_min: z.coerce.number().int().min(1).max(100).optional().default(1),
  team_max: z.coerce.number().int().min(1).max(100).optional().default(4),
  team_fee_rupees: z.coerce
    .number()
    .int("Whole rupees only")
    .min(0, "Fee can't be negative")
    .max(1_000_000)
    .optional()
    .default(0),
});

export type EventInput = z.infer<typeof eventSchema>;

/**
 * Event Offers edited on the event form: a verified payment for THIS event
 * (the source) gives `discount_rupees` off each target event. Directed: it
 * says nothing about the reverse direction.
 */
export const eventOfferSchema = z.object({
  target_event_id: z.string().uuid("Pick a target event"),
  discount_rupees: z.coerce
    .number({ message: "Enter a discount amount" })
    .int("Whole rupees only")
    .min(1, "Offer discount must be at least ₹1")
    .max(1_000_000, "Offer discount is too large"),
  enabled: z.coerce.boolean().optional().default(true),
});

export const eventOffersSchema = z
  .array(eventOfferSchema)
  .max(200, "Too many offers")
  .superRefine((offers, ctx) => {
    const seen = new Set<string>();
    offers.forEach((o, i) => {
      if (seen.has(o.target_event_id))
        ctx.addIssue({
          code: "custom",
          path: [i, "target_event_id"],
          message: "Each target event can only have one offer.",
        });
      seen.add(o.target_event_id);
    });
  });

export type EventOfferInput = z.infer<typeof eventOfferSchema>;
