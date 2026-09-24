"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { CalendarDays, CalendarRange, ChefHat, Flame, LayoutDashboard, LogOut, MessageCircle, Package, Users, UserRound, Wallet } from "lucide-react";
import { logoutAction } from "@/lib/authActions";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Heute", icon: LayoutDashboard },
  { href: "/assistant", label: "Coach", icon: MessageCircle },
  { href: "/plan", label: "Woche", icon: CalendarDays },
  { href: "/meal-plans", label: "Planer", icon: CalendarRange },
  { href: "/pantry", label: "Vorräte", icon: Package },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/household", label: "Haushalt", icon: Users },
  { href: "/trends", label: "Trends", icon: Flame },
  { href: "/recipes", label: "Rezepte", icon: ChefHat },
  { href: "/onboarding", label: "Profil", icon: UserRound },
];

function isActive(pathname: string | null, href: string) {
  return pathname === href || (pathname?.startsWith(href + "/") ?? false);
}

/**
 * Bewusst eine schwebende, dunkle Glas-Leiste statt einer edge-to-edge
 * hellen Kopfzeile - der deutlichste Kontrast-Moment der App (siehe
 * Kapitel-Vorgabe "vermeide alles-hellgrau-auf-hellgrau") und der einzige
 * Ort, an dem die inverse Oberfläche (.glass-dark) verwendet wird.
 */
export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-4 z-30 px-4 sm:px-6">
      <div className="glass-dark shadow-lift mx-auto flex max-w-[1080px] items-center justify-between rounded-full border px-5 py-2.5">
        <Link href="/dashboard" className="pl-1 text-[15px] font-semibold text-on-inverse">
          VYN
        </Link>
        <nav className="hidden items-center gap-1 text-[13px] font-medium text-on-inverse-soft lg:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-full px-3 py-1.5 transition-colors duration-[var(--duration-fast)] ${
                  active ? "text-on-inverse" : "hover:text-on-inverse"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="topnav-active"
                    className="absolute inset-0 rounded-full bg-white/10"
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
                <span className="relative">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <form action={logoutAction} className="hidden lg:block">
          <button
            type="submit"
            aria-label="Abmelden"
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-inverse-soft transition-colors duration-[var(--duration-fast)] hover:bg-white/10 hover:text-on-inverse"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </header>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="glass-dark shadow-lift rail fixed inset-x-3 bottom-3 z-30 flex items-center gap-0.5 rounded-full border px-1.5 py-1.5 lg:hidden"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-11 min-w-14 shrink-0 flex-col items-center gap-0.5 rounded-full px-2.5 py-2 text-[10px] font-medium transition-colors duration-[var(--duration-fast)] ${
              active ? "text-on-inverse" : "text-on-inverse-soft"
            }`}
          >
            {active && (
              <motion.span
                layoutId="mobilenav-active"
                className="absolute inset-0 rounded-full bg-white/10"
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
            <Icon className="relative h-5 w-5" strokeWidth={active ? 2.4 : 2} color={active ? "var(--color-primary)" : undefined} />
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
