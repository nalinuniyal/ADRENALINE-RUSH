import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Coloured square object icon, like Lightning's standard object icons. */
const COLORS = {
  blue: "bg-[#0176d3]",
  navy: "bg-[#032d60]",
  teal: "bg-[#06a59a]",
  violet: "bg-[#9050e9]",
  orange: "bg-[#fe9339]",
  pink: "bg-[#e3066a]",
  green: "bg-[#2e844a]",
  sky: "bg-[#1b96ff]",
  indigo: "bg-[#5867e8]",
  slate: "bg-[#5c5c5c]",
} as const;

export type IconTileColor = keyof typeof COLORS;

export function IconTile({ icon: Icon, color = "blue", size = "md", className }: { icon: LucideIcon; color?: IconTileColor; size?: "sm" | "md" | "lg"; className?: string }) {
  const dims = { sm: "size-6 rounded", md: "size-8 rounded-md", lg: "size-11 rounded-lg" }[size];
  const icon = { sm: "size-3.5", md: "size-4.5", lg: "size-6" }[size];
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center text-white shadow-sm", COLORS[color], dims, className)}>
      <Icon className={icon} aria-hidden />
    </span>
  );
}
