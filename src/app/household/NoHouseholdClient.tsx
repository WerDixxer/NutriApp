"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** Zustand nach dem Verlassen/Auflösen eines Haushalts (siehe session.ts:requireHouseholdId). */
export default function NoHouseholdClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, currency: "EUR" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Anlegen.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6">
      <p className="text-body text-ink-soft">
        Du bist aktuell in keinem Haushalt. Leg einen neuen an, oder nutze einen Einladungslink, den du bekommen hast.
      </p>
      <form onSubmit={handleCreate} className="mt-5 flex flex-wrap items-center gap-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Meine WG" required className="w-56" />
        <Button type="submit" size="sm" disabled={submitting}>
          Haushalt anlegen
        </Button>
      </form>
      {error && <p className="mt-3 text-[13.5px] font-semibold text-danger">{error}</p>}
    </Card>
  );
}
