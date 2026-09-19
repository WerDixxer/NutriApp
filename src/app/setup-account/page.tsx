import { redirect } from "next/navigation";
import { getClaimableAccountName, setupAccountAction } from "@/lib/authActions";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

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
      <span className="text-label text-ink-faint">Good Order</span>
      <h1 className="text-h1 mt-2 text-ink">Konto einrichten</h1>
      <p className="text-body mt-4 text-ink-soft">
        Dein bestehendes Profil &quot;{claimableName}&quot; wurde auf Konten umgestellt. Vergib eine E-Mail-Adresse
        und ein Passwort, um dich künftig damit anzumelden. Alle deine Daten bleiben unverändert erhalten.
      </p>

      <form action={setupAccountAction} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">E-Mail</span>
          <Input name="email" type="email" required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Passwort</span>
          <Input name="password" type="password" required minLength={8} />
        </label>

        {error && <p className="text-[13.5px] font-semibold text-danger">{ERROR_MESSAGES[error] ?? "Einrichtung fehlgeschlagen."}</p>}

        <Button type="submit" className="mt-2">
          Konto einrichten
        </Button>
      </form>
    </div>
  );
}
