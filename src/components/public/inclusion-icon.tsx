import {
  Award,
  BadgeCheck,
  BookOpen,
  Briefcase,
  Calendar,
  Check,
  Clock,
  CodeXml,
  FileText,
  GraduationCap,
  Hammer,
  Handshake,
  Headphones,
  LifeBuoy,
  MessagesSquare,
  Mic,
  Presentation,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  Video,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { isInclusionIcon, type InclusionIcon as IconName } from "@/lib/validation/courses";

const ICONS: Record<IconName, LucideIcon> = {
  check: Check,
  mic: Mic,
  "messages-square": MessagesSquare,
  briefcase: Briefcase,
  handshake: Handshake,
  users: Users,
  presentation: Presentation,
  hammer: Hammer,
  wrench: Wrench,
  code: CodeXml,
  "life-buoy": LifeBuoy,
  headphones: Headphones,
  "graduation-cap": GraduationCap,
  award: Award,
  "badge-check": BadgeCheck,
  "book-open": BookOpen,
  "file-text": FileText,
  video: Video,
  calendar: Calendar,
  clock: Clock,
  rocket: Rocket,
  target: Target,
  trophy: Trophy,
  sparkles: Sparkles,
  "shield-check": ShieldCheck,
};

/** Renders a "What's included" icon by its allowlisted name; anything else falls back to a check mark. */
export function InclusionIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = isInclusionIcon(name) ? ICONS[name] : Check;
  return <Icon className={className} aria-hidden />;
}
