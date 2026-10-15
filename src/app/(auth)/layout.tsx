import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Aurora } from "@/components/fx/aurora";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative isolate flex min-h-full flex-1 flex-col overflow-hidden bg-gradient-to-br from-ink-950 via-ink-900 to-[#0b2a5c]">
      <Aurora />
      <header className="relative mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
        <Link href="/" aria-label="Adrenaline Rush home">
          <Logo inverse />
        </Link>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">{children}</main>
    </div>
  );
}
