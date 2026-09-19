import Link from "next/link";
import { auth } from "@/lib/auth";
import { previewInvite } from "@/lib/household/inviteService";
import { acceptInviteAction, registerViaInviteAction } from "@/lib/authActions";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Bitte alle Felder korrekt ausfüllen (Passwort mindestens 8 Zeichen).",
  exists: "Für diese E-Mail existiert bereits ein Konto. Melde dich stattdessen an.",
  invite: "Diese Einladung ist inzwischen ungültig oder abgelaufen.",
  email: "Diese Einladung ist für eine andere E-Mail-Adresse bestimmt.",
  already: "Du gehörst bereits einem Haushalt an. Verlasse ihn zuerst, um beizutreten.",
};

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const [preview, session] = await Promise.all([previewInvite(token), auth()]);

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <span className="text-label text-ink-faint">Good Order</span>
      <h1 className="text-h1 mt-2 text-ink">Haushalts-Einladung</h1>

      {!preview ? (
        <p className="text-body mt-6 text-ink-soft">
          Diese Einladung ist ungültig, abgelaufen oder wurde bereits angenommen.
        </p>
      ) : (
        <>
          <p className="text-body mt-4 text-ink-soft">
            Du wurdest eingeladen, dem Haushalt &quot;{preview.householdName}&quot; beizutreten.
          </p>

          {error && <p className="mt-4 text-[13.5px] font-semibold text-danger">{ERROR_MESSAGES[error] ?? "Beitritt fehlgeschlagen."}</p>}

          {session?.user ? (
            <form action={acceptInviteAction} className="mt-8 flex flex-col gap-4">
              <input type="hidden" name="token" value={token} />
              <Button type="submit">Haushalt beitreten</Button>
            </form>
          ) : (
            <>
              <form action={registerViaInviteAction} className="mt-8 flex flex-col gap-4">
                <input type="hidden" name="token" value={token} />
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
                <Button type="submit" className="mt-2">
                  Registrieren & beitreten
                </Button>
              </form>
              <p className="text-body mt-6 text-ink-soft">
                Schon registriert?{" "}
                <Link href="/login" className="font-semibold text-ink underline underline-offset-2">
                  Anmelden
                </Link>{" "}
                und diesen Link danach erneut öffnen.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
