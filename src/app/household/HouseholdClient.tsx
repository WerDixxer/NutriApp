"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserRound } from "lucide-react";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export interface HouseholdView {
  id: string;
  name: string;
  currency: string;
}

export interface MemberView {
  id: string;
  role: "OWNER" | "MEMBER";
  joinedAt: string;
  user: { id: string; name: string | null; email: string | null };
}

export interface InviteView {
  id: string;
  invitedEmail: string;
  role: "OWNER" | "MEMBER";
  expiresAt: string;
  createdAt: string;
}

const ROLE_LABELS: Record<"OWNER" | "MEMBER", string> = { OWNER: "Owner", MEMBER: "Member" };

function memberDisplayName(user: { name: string | null; email: string | null }): string {
  return user.name ?? user.email ?? "Unbekannt";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function HouseholdClient({
  household,
  role,
  memberId,
  initialMembers,
  initialInvites,
}: {
  household: HouseholdView;
  role: "OWNER" | "MEMBER";
  memberId: string;
  initialMembers: MemberView[];
  initialInvites: InviteView[];
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [householdName, setHouseholdName] = useState(household.name);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(household.name);

  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);

  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = role === "OWNER";
  const otherMembers = members.filter((m) => m.id !== memberId);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/household", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput, currency: household.currency }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Speichern.");
      setHouseholdName(data.household.name);
      setEditingName(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/household/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Einladen.");
      setGeneratedInviteUrl(`${window.location.origin}${data.inviteUrl}`);
      setInviteEmail("");
      setInvites((prev) => [
        { id: data.inviteId, invitedEmail: inviteEmail, role: "MEMBER", expiresAt: data.expiresAt, createdAt: new Date().toISOString() },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeInvite(id: string) {
    setInvites((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/household/invites/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function handleRemoveMember(id: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/household/members/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Entfernen.");
      setMembers((prev) => prev.filter((m) => m.id !== id));
      setConfirmingRemove(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTransferOwnership() {
    if (!transferTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/household/transfer-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMemberId: transferTarget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler bei der Übertragung.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLeave() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/household/leave", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Verlassen.");
      router.push("/household");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
      setSubmitting(false);
    }
  }

  return (
    <div>
      {error && <p className="mb-4 text-[13.5px] font-semibold text-danger">{error}</p>}

      <Card className="p-6">
        {editingName ? (
          <form onSubmit={handleSaveName} className="flex flex-wrap items-center gap-3">
            <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} required autoFocus className="w-56" />
            <Button type="submit" size="sm" disabled={submitting}>
              Speichern
            </Button>
            <button type="button" onClick={() => setEditingName(false)} className="text-xs font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink">
              Abbrechen
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-h2 text-ink">{householdName}</h2>
              <p className="mt-0.5 text-[12px] font-medium text-ink-faint">Standardwährung: {household.currency}</p>
            </div>
            {isOwner && (
              <button onClick={() => { setNameInput(householdName); setEditingName(true); }} className="text-xs font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink">
                Haushalt bearbeiten
              </button>
            )}
          </div>
        )}
      </Card>

      <div className="mt-10">
        <h2 className="text-h3 mb-3 text-ink">
          Mitglieder <span className="text-label font-medium text-ink-faint">({members.length})</span>
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {members.map((m) => (
            <Card key={m.id} className="flex min-h-[76px] items-center justify-between gap-3 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-bg text-ink-soft">
                  <UserRound className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[15px] font-semibold text-ink">
                    {memberDisplayName(m.user)}
                    {m.id === memberId && <span className="ml-1.5 font-normal text-ink-faint">(du)</span>}
                  </p>
                  <p className="text-label text-ink-faint">{ROLE_LABELS[m.role]}</p>
                </div>
              </div>
              {isOwner && m.id !== memberId && m.role !== "OWNER" && (
                <div>
                  {confirmingRemove === m.id ? (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleRemoveMember(m.id)} disabled={submitting} className="text-xs font-semibold text-primary hover:text-primary-dark">
                        Entfernen?
                      </button>
                      <button onClick={() => setConfirmingRemove(null)} className="text-xs font-semibold text-ink-soft hover:text-ink">
                        Abbrechen
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingRemove(m.id)}
                      aria-label="Mitglied entfernen"
                      className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-primary"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {isOwner && (
        <div className="mt-10 border-t border-border pt-8">
          <h2 className="text-h3 mb-3 text-ink">Mitglied hinzufügen</h2>
          {inviting ? (
            <form onSubmit={handleInvite} className="flex flex-col gap-4 rounded-[var(--radius-md)] bg-bg-dim p-5">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-semibold text-ink">E-Mail-Adresse</span>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="partner@example.com"
                  required
                />
              </label>
              <div className="flex items-center gap-4">
                <Button type="submit" size="sm" disabled={submitting}>
                  Einladungslink erstellen
                </Button>
                <button type="button" onClick={() => setInviting(false)} className="text-[13px] font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink">
                  Abbrechen
                </button>
              </div>
            </form>
          ) : (
            <Button size="sm" onClick={() => { setInviting(true); setGeneratedInviteUrl(null); }}>
              <Plus className="h-4 w-4" /> Mitglied hinzufügen
            </Button>
          )}

          {generatedInviteUrl && (
            <Card className="mt-4 bg-accent-soft p-4 text-[13.5px] text-ink">
              <p className="font-semibold">Einladungslink erstellt. Teile ihn direkt mit der Person:</p>
              <p className="num mt-2 break-all rounded-[var(--radius-sm)] bg-bg px-3 py-2 text-xs">{generatedInviteUrl}</p>
              <p className="mt-2 text-xs text-ink-faint">Gültig 7 Tage. Es gibt noch keinen automatischen E-Mail-Versand.</p>
            </Card>
          )}

          {invites.length > 0 && (
            <div className="mt-6">
              <h3 className="text-label mb-2 text-ink-faint">Offene Einladungen</h3>
              {invites.map((invite) => (
                <div key={invite.id} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border py-3">
                  <div>
                    <p className="text-[13.5px] font-medium text-ink">{invite.invitedEmail}</p>
                    <p className="text-[12px] text-ink-faint">Läuft ab am {formatDate(invite.expiresAt)}</p>
                  </div>
                  <button onClick={() => handleRevokeInvite(invite.id)} className="text-xs font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-primary">
                    Zurückziehen
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-10 border-t border-border pt-8">
        <h2 className="text-h3 mb-3 text-ink">Haushalt verlassen</h2>

        {isOwner && otherMembers.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <p className="text-body w-full text-ink-soft">
              Als Owner musst du zuerst die Eigentümerschaft übertragen, bevor du gehen kannst.
            </p>
            <Select value={transferTarget} onChange={(e) => setTransferTarget(e.target.value)} className="w-auto">
              <option value="">Neuen Owner wählen…</option>
              {otherMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {memberDisplayName(m.user)}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={handleTransferOwnership} disabled={submitting || !transferTarget}>
              Eigentümerschaft übertragen
            </Button>
          </div>
        )}

        {(!isOwner || otherMembers.length === 0) &&
          (confirmingLeave ? (
            <div className="flex items-center gap-3">
              <p className="text-body text-ink-soft">
                {isOwner ? "Der Haushalt wird endgültig aufgelöst, inklusive Vorräten, Budget und Ausgaben." : "Du verlierst den Zugriff auf die gemeinsamen Haushaltsdaten."}
              </p>
              <button onClick={handleLeave} disabled={submitting} className="shrink-0 text-[14px] font-semibold text-primary hover:text-primary-dark">
                {isOwner ? "Auflösen" : "Verlassen"}
              </button>
              <button onClick={() => setConfirmingLeave(false)} className="shrink-0 text-[14px] font-semibold text-ink-soft hover:text-ink">
                Abbrechen
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmingLeave(true)} className="text-[14px] font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-primary">
              {isOwner ? "Haushalt auflösen" : "Haushalt verlassen"}
            </button>
          ))}
      </div>
    </div>
  );
}
