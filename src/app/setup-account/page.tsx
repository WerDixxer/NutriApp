import { redirect } from "next/navigation";
import { getClaimableAccountName, setupAccountAction } from "@/lib/authActions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Bitte alle Felder korrekt ausfüllen (Passwort mindestens 8 Zeichen).",
  exists: "Für diese E-Mail existiert bereits ein Konto.",
};

export default async function SetupAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const claimableName = await getClaimableAccountName();
  if (!claimableName) redirect("/register");

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">NutriCoach</span>
      <h1 className="font-display mt-2 text-[34px] leading-[1.05] text-ink">Konto einrichten</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
        Dein bestehendes Profil &quot;{claimableName}&quot; wurde auf Konten umgestellt. Vergib jetzt eine
        E-Mail-Adresse und ein Passwort, um dich künftig damit anzumelden. Alle deine Daten
        (Ziele, Rezepte, Log, Pläne) bleiben unverändert erhalten.
      </p>

      <form action={setupAccountAction} className="mt-8 flex flex-col gap-4">
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
            minLength={8}
            className="rounded-xl bg-bg-dim px-3 py-2.5 text-sm text-ink outline-none"
          />
        </label>

        {error && <p className="text-sm font-semibold text-primary">{ERROR_MESSAGES[error] ?? "Einrichtung fehlgeschlagen."}</p>}

        <button
          type="submit"
          className="mt-2 inline-flex items-center justify-center rounded-full bg-ink px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-black"
        >
          Konto einrichten
        </button>
      </form>
    </div>
  );
}
