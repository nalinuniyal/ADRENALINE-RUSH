import {
  BarChart3,
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  Megaphone,
  PlayCircle,
  Settings,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/lib/auth/permissions";
import type { IconTileColor } from "@/components/ui/icon-tile";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  courses: BookOpen,
  candidates: Users,
  batches: UsersRound,
  calendar: CalendarDays,
  resources: PlayCircle,
  finance: Wallet,
  marketing: Megaphone,
  analytics: BarChart3,
  settings: Settings,
};

/** Object colour for each module, used on page headers and the app launcher. */
export const NAV_COLORS: Record<NavIcon, IconTileColor> = {
  dashboard: "sky",
  courses: "violet",
  candidates: "blue",
  batches: "teal",
  calendar: "pink",
  resources: "orange",
  finance: "green",
  marketing: "indigo",
  analytics: "navy",
  settings: "slate",
};
