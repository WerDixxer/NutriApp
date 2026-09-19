import type { NextAuthConfig } from "next-auth";

/**
 * Edge-taugliche Basis-Config (keine Prisma-/bcrypt-Importe, läuft in der
 * Middleware). Die volle Config inkl. Adapter + Credentials-Provider lebt in
 * `auth.ts` und wird nur in Route Handlern/Server Components geladen.
 */
const PUBLIC_PATHS = ["/login", "/register", "/setup-account"];
// Eigenes Präfix statt in PUBLIC_PATHS: /invite/[token] ist dynamisch, ein
// Invite-Link muss auch ohne Login aufrufbar sein (siehe household/invite/
// page.tsx), damit ein neuer Nutzer die Einladung erst sehen und sich dann
// registrieren kann.
const PUBLIC_PATH_PREFIXES = ["/invite/"];

export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        PUBLIC_PATHS.includes(pathname) ||
        pathname.startsWith("/api/auth") ||
        PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
      const isLoggedIn = !!auth?.user;

      if (isPublic) {
        if (isLoggedIn && (pathname === "/login" || pathname === "/register")) {
          return Response.redirect(new URL("/dashboard", request.nextUrl));
        }
        return true;
      }

      return isLoggedIn;
    },
  },
};
