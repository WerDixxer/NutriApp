import type { Metadata } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { TopNav, MobileNav } from "@/components/Nav";
import { MotionProvider } from "@/components/MotionProvider";
import { auth } from "@/lib/auth";
import "./globals.css";

// Einzige Schriftfamilie der App (Fließtext UND Headlines/große Zahlen,
// siehe globals.css .text-*). Bewusst gegen Inter/Space Grotesk ausgetauscht:
// wärmer/humaner als Inter, mit mehr Eigencharakter, aber ohne die kühle,
// stark geometrische Anmutung von Space Grotesk - passt besser zur warmen,
// naturnahen Farbpalette als ein rein technisches Display-Font-Pairing.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Nur für kleine technische Datenpunkte (.text-tech), nie für Fließtext -
// siehe globals.css.
const mono = IBM_Plex_Mono({
  variable: "--font-mono-tech",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "VYN",
  description: "Dein personalisierter Ernährungs- und Trainings-Coach, ohne Online-Coach-Abo.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  return (
    <html lang="de" className={`${jakarta.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-ink">
        <MotionProvider>
          {isLoggedIn && <TopNav />}
          <main
            className={
              isLoggedIn
                ? "mx-auto w-full max-w-[1080px] px-6 pb-28 pt-10 lg:pb-16"
                : "mx-auto w-full max-w-[1080px]"
            }
          >
            {children}
          </main>
          {isLoggedIn && <MobileNav />}
        </MotionProvider>
      </body>
    </html>
  );
}
