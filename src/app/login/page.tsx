import Link from "next/link";
import { loginAction } from "@/lib/authActions";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

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
      <span className="text-label text-ink-faint">VYN</span>
      <h1 className="text-h1 mt-2 text-ink">Willkommen zurück.</h1>

      <form action={loginAction} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">E-Mail</span>
          <Input name="email" type="email" required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Passwort</span>
          <Input name="password" type="password" required />
        </label>

        {error && <p className="text-[13.5px] font-semibold text-danger">{ERROR_MESSAGES[error] ?? "Anmeldung fehlgeschlagen."}</p>}

        <Button type="submit" className="mt-2">
          Anmelden
        </Button>
      </form>

      <p className="text-body mt-6 text-ink-soft">
        Noch kein Konto?{" "}
        <Link href="/register" className="font-semibold text-ink underline underline-offset-2">
          Registrieren
        </Link>
      </p>
      <p className="text-body mt-2 text-ink-soft">
        Bestehendes Profil noch nicht mit einem Konto verknüpft?{" "}
        <Link href="/setup-account" className="font-semibold text-ink underline underline-offset-2">
          Konto einrichten
        </Link>
      </p>
    </div>
  );
}
