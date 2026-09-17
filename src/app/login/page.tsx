import Link from "next/link";
import { loginAction } from "@/lib/authActions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Bitte E-Mail und Passwort eingeben.",
  credentials: "E-Mail oder Passwort stimmt nicht.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">NutriCoach</span>
      <h1 className="font-display mt-2 text-[34px] leading-[1.05] text-ink">Anmelden</h1>

      <form action={loginAction} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">E-Mail</span>
          <input
            name="email"
            type="email"
            required
            className="rounded-xl bg-bg-dim px-3 py-2.5 text-sm text-ink outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Passwort</span>
          <input
            name="password"
            type="password"
            required
            className="rounded-xl bg-bg-dim px-3 py-2.5 text-sm text-ink outline-none"
          />
        </label>

        {error && <p className="text-sm font-semibold text-primary">{ERROR_MESSAGES[error] ?? "Anmeldung fehlgeschlagen."}</p>}

        <button
          type="submit"
          className="mt-2 inline-flex items-center justify-center rounded-full bg-ink px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-black"
        >
          Anmelden
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-soft">
        Noch kein Konto?{" "}
        <Link href="/register" className="font-semibold text-ink underline underline-offset-2">
          Registrieren
        </Link>
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        Bestehendes Profil noch nicht mit einem Konto verknüpft?{" "}
        <Link href="/setup-account" className="font-semibold text-ink underline underline-offset-2">
          Konto einrichten
        </Link>
      </p>
    </div>
  );
}
