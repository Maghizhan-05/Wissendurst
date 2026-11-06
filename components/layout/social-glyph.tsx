import { AtSign, Globe, MessageCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SocialPlatform } from "@/lib/content/social";

/** Fixed, code-defined platform icons — never taken from stored data. */
export function SocialGlyph({ p, className }: { p: SocialPlatform; className?: string }) {
  const c = cn("size-[18px]", className);
  switch (p) {
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" className={c} fill="currentColor" aria-hidden>
          <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4A21 21 0 0 0 14.4 4.3c-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.5V21h3z" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
          <path d="M4 4l16 16M20 4L4 20" />
        </svg>
      );
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" className={c} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" className={c} fill="currentColor" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <rect x="7" y="10" width="2" height="7" /><circle cx="8" cy="7.3" r="1.2" /><path d="M11 10h2v1c.4-.7 1.2-1.2 2.3-1.2 1.8 0 2.7 1.1 2.7 3.1V17h-2v-3.8c0-1-.4-1.6-1.3-1.6S13 12.2 13 13.2V17h-2z" />
        </svg>
      );
    case "whatsapp":
      return <MessageCircle className={c} aria-hidden />;
    case "telegram":
      return <Send className={c} aria-hidden />;
    case "threads":
      return <AtSign className={c} aria-hidden />;
    default:
      return <Globe className={c} aria-hidden />;
  }
}
