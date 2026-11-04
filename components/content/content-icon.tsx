import {
  Award,
  BookOpen,
  Brain,
  CalendarDays,
  Dna,
  FileText,
  FlaskConical,
  GraduationCap,
  HeartPulse,
  Info,
  Lightbulb,
  MapPin,
  MessagesSquare,
  Microscope,
  Pill,
  Presentation,
  Stethoscope,
  Trophy,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { IconKey } from "@/lib/content/validation";

/** Allowlisted icons admins can pick (keys validated by ICON_KEYS). */
export const CONTENT_ICONS: Record<IconKey, LucideIcon> = {
  wrench: Wrench,
  "messages-square": MessagesSquare,
  presentation: Presentation,
  "file-text": FileText,
  trophy: Trophy,
  "graduation-cap": GraduationCap,
  stethoscope: Stethoscope,
  microscope: Microscope,
  "heart-pulse": HeartPulse,
  brain: Brain,
  pill: Pill,
  "flask-conical": FlaskConical,
  dna: Dna,
  users: Users,
  "calendar-days": CalendarDays,
  "map-pin": MapPin,
  "book-open": BookOpen,
  lightbulb: Lightbulb,
  award: Award,
  info: Info,
};

export function ContentIcon({
  name,
  className,
  strokeWidth,
}: {
  name: IconKey;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = CONTENT_ICONS[name] ?? Info;
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden />;
}
