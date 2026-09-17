"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChefHat, Flame, LayoutDashboard, LogOut, MessageCircle, UserRound } from "lucide-react";
import { logoutAction } from "@/lib/authActions";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Heute", icon: LayoutDashboard },
  { href: "/assistant", label: "Coach", icon: MessageCircle },
  { href: "/plan", label: "Woche", icon: CalendarDays },
  { href: "/trends", label: "Trends", icon: Flame },
  { href: "/recipes", label: "Rezepte", icon: ChefHat },
  { href: "/onboarding", label: "Profil", icon: UserRound },
];

function isActive(pathname: string | null, href: string) {
  return pathname === href || (pathname?.startsWith(href + "/") ?? false);
}

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1040px] items-center justify-between px-6 py-4">
        <Link href="/dashboard" className="font-display text-[17px] text-ink">
          NutriCoach
        </Link>
        <nav className="hidden items-center gap-7 text-[13px] font-medium text-ink-soft md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(pathname, item.href) ? "text-ink" : "hover:text-ink"}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={logoutAction} className="hidden md:block">
          <button
            type="submit"
            aria-label="Abmelden"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:text-primary"
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
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-border bg-bg/90 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-1 px-3 py-2.5 text-[10px] font-medium ${
              active ? "text-primary" : "text-ink-soft"
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
