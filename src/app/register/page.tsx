import Link from "next/link";
import { registerAction } from "@/lib/authActions";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Bitte alle Felder korrekt ausfüllen (Passwort mindestens 8 Zeichen).",
  exists: "Für diese E-Mail existiert bereits ein Konto.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <span className="text-label text-ink-faint">VYN</span>
      <h1 className="text-h1 mt-2 text-ink">Los geht&apos;s.</h1>

      <form action={registerAction} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Name</span>
          <Input name="name" required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">E-Mail</span>
          <Input name="email" type="email" required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Passwort</span>
          <Input name="password" type="password" required minLength={8} />
        </label>

        {error && <p className="text-[13.5px] font-semibold text-danger">{ERROR_MESSAGES[error] ?? "Registrierung fehlgeschlagen."}</p>}

        <Button type="submit" className="mt-2">
          Konto erstellen
        </Button>
      </form>

      <p className="text-body mt-6 text-ink-soft">
        Schon registriert?{" "}
        <Link href="/login" className="font-semibold text-ink underline underline-offset-2">
          Anmelden
        </Link>
      </p>
    </div>
  );
}
