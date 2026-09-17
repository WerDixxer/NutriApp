import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TopNav, MobileNav } from "@/components/Nav";
import { auth } from "@/lib/auth";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "NutriCoach",
  description: "Dein personalisierter Ernährungs- und Trainings-Coach, ohne Online-Coach-Abo.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  return (
    <html lang="de" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-ink">
        {isLoggedIn && <TopNav />}
        <main
          className={
            isLoggedIn
              ? "mx-auto w-full max-w-[1040px] px-6 pb-28 pt-8 md:pb-16"
              : "mx-auto w-full max-w-[1040px]"
          }
        >
          {children}
        </main>
        {isLoggedIn && <MobileNav />}
      </body>
    </html>
  );
}
