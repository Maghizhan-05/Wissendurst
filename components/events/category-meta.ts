import {
  Wrench,
  MessagesSquare,
  Presentation,
  FileText,
  Trophy,
  GraduationCap,
  Stethoscope,
  BookOpen,
  Mic,
  Brain,
  HeartPulse,
  Microscope,
  FlaskConical,
  PenTool,
  Users,
  Lightbulb,
  Globe,
  Music,
  Camera,
  Puzzle,
  Award,
  Languages,
  Palette,
  type LucideIcon,
} from "lucide-react";
import type { CategoryIconKey } from "@/lib/events/categories";

/**
 * Plain (server-safe) category icon allowlist, keyed by event_categories.icon_key.
 * Kept out of any "use client" module so Server Components can import it.
 * Tints live in CATEGORY_COLORS (lib/events/categories).
 */
export const CATEGORY_ICON: Record<CategoryIconKey, LucideIcon> = {
  wrench: Wrench,
  "messages-square": MessagesSquare,
  presentation: Presentation,
  "file-text": FileText,
  trophy: Trophy,
  "graduation-cap": GraduationCap,
  stethoscope: Stethoscope,
  "book-open": BookOpen,
  mic: Mic,
  brain: Brain,
  "heart-pulse": HeartPulse,
  microscope: Microscope,
  "flask-conical": FlaskConical,
  "pen-tool": PenTool,
  users: Users,
  lightbulb: Lightbulb,
  globe: Globe,
  music: Music,
  camera: Camera,
  puzzle: Puzzle,
  award: Award,
  languages: Languages,
  palette: Palette,
};
