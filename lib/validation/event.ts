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
  // Sibling discount, meaningful on a broader (top-level) event.
  discount_enabled: z.coerce.boolean().optional().default(false),
  discount_amount_rupees: z.coerce
    .number()
    .int("Whole rupees only")
    .min(0, "Discount can't be negative")
    .max(1_000_000)
    .optional()
    .default(0),
});

export type EventInput = z.infer<typeof eventSchema>;
