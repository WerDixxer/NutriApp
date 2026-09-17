"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PANTRY_LOCATION_LABELS, EXPIRATION_TYPE_LABELS } from "@/lib/labels";

export interface PantryItemView {
  id: string;
  name: string;
  quantity: number;
  remainingQuantity: number;
  unit: string;
  category: string | null;
  purchaseDate: string | null;
  expirationDate: string | null;
  expirationDateType: string;
  location: string;
  opened: boolean;
  cooked: boolean;
  notes: string | null;
  rotation: { urgency: "HIGH" | "MEDIUM" | "LOW"; score: number; reasons: string[] };
}

const UNIT_LABELS: Record<string, string> = {
  G: "g",
  KG: "kg",
  ML: "ml",
  L: "l",
  PIECE: "Stück",
  PACK: "Packung",
  PORTION: "Portion",
};

const LOCATIONS = Object.keys(PANTRY_LOCATION_LABELS);

const URGENCY_DOT: Record<string, string> = {
  HIGH: "var(--color-primary)",
  MEDIUM: "#f5a623",
  LOW: "var(--color-border)",
};

const inputClass = "rounded-xl bg-bg-dim px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft/60";

interface FormState {
  name: string;
  quantity: string;
  unit: string;
  category: string;
  purchaseDate: string;
  expirationDate: string;
  expirationKnown: "UNKNOWN" | "EXACT" | "ESTIMATED";
  location: string;
  opened: boolean;
  cooked: boolean;
  notes: string;
}

function emptyForm(): FormState {
  return {
    name: "",
    quantity: "",
    unit: "G",
    category: "",
    purchaseDate: "",
    expirationDate: "",
    expirationKnown: "UNKNOWN",
    location: "OTHER",
    opened: false,
    cooked: false,
    notes: "",
  };
}

function toForm(item: PantryItemView): FormState {
  return {
    name: item.name,
    quantity: String(item.quantity),
    unit: item.unit,
    category: item.category ?? "",
    purchaseDate: item.purchaseDate ? item.purchaseDate.slice(0, 10) : "",
    expirationDate: item.expirationDate ? item.expirationDate.slice(0, 10) : "",
    expirationKnown: item.expirationDateType as "UNKNOWN" | "EXACT" | "ESTIMATED",
    location: item.location,
    opened: item.opened,
    cooked: item.cooked,
    notes: item.notes ?? "",
  };
}

function defaultStep(unit: string): number {
  if (unit === "G" || unit === "ML") return 50;
  if (unit === "KG" || unit === "L") return 0.1;
  return 1;
}

function formatQuantity(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function PantryForm({
  initial,
  onCancel,
  onSubmit,
  submitting,
}: {
  initial: FormState;
  onCancel: () => void;
  onSubmit: (form: FormState) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState(initial);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="flex flex-col gap-4 rounded-2xl bg-bg-dim p-5"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Name</span>
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="z.B. Hähnchenbrust"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Kategorie (optional)</span>
          <input
            className={inputClass}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="z.B. Fleisch"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Menge</span>
          <input
            className={inputClass}
            type="number"
            step="any"
            min={0.01}
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            required
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Einheit</span>
          <select className={inputClass} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {Object.entries(UNIT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Lagerort</span>
          <select className={inputClass} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
            {LOCATIONS.map((v) => (
              <option key={v} value={v}>
                {PANTRY_LOCATION_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Gekauft am</span>
          <input
            className={inputClass}
            type="date"
            value={form.purchaseDate}
            onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Ablaufdatum-Typ</span>
          <select
            className={inputClass}
            value={form.expirationKnown}
            onChange={(e) => {
              const next = e.target.value as FormState["expirationKnown"];
              setForm({ ...form, expirationKnown: next, expirationDate: next === "UNKNOWN" ? "" : form.expirationDate });
            }}
          >
            <option value="UNKNOWN">Kein Ablaufdatum</option>
            <option value="EXACT">Genaues Datum</option>
            <option value="ESTIMATED">Geschätztes Datum</option>
          </select>
        </label>
        {form.expirationKnown !== "UNKNOWN" && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold text-ink">Ablaufdatum</span>
            <input
              className={inputClass}
              type="date"
              value={form.expirationDate}
              onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
              required
            />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={form.opened} onChange={(e) => setForm({ ...form, opened: e.target.checked })} />
          Bereits geöffnet
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={form.cooked} onChange={(e) => setForm({ ...form, cooked: e.target.checked })} />
          Bereits gekocht
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-ink">Notizen (optional)</span>
        <textarea
          className={`${inputClass} min-h-[60px] resize-y`}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50"
        >
          Speichern
        </button>
        <button type="button" onClick={onCancel} className="text-sm font-semibold text-ink-soft hover:text-ink">
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function formToPayload(form: FormState) {
  return {
    name: form.name,
    quantity: Number(form.quantity),
    unit: form.unit,
    category: form.category || undefined,
    purchaseDate: form.purchaseDate || undefined,
    expirationDate: form.expirationKnown === "UNKNOWN" ? undefined : form.expirationDate || undefined,
    expirationDateType: form.expirationKnown,
    location: form.location,
    opened: form.opened,
    cooked: form.cooked,
    notes: form.notes || undefined,
  };
}

export default function PantryClient({ initialItems }: { initialItems: PantryItemView[] }) {
  const [items, setItems] = useState(initialItems);
  const [sortMode, setSortMode] = useState<"urgency" | "expiration">("urgency");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      if (sortMode === "urgency") return b.rotation.score - a.rotation.score;
      const aDate = a.expirationDate ? new Date(a.expirationDate).getTime() : Infinity;
      const bDate = b.expirationDate ? new Date(b.expirationDate).getTime() : Infinity;
      return aDate - bDate;
    });
    const map = new Map<string, PantryItemView[]>();
    for (const loc of LOCATIONS) map.set(loc, []);
    for (const item of sorted) {
      if (!map.has(item.location)) map.set(item.location, []);
      map.get(item.location)!.push(item);
    }
    return map;
  }, [items, sortMode]);

  async function handleCreate(form: FormState) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pantry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(form)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Speichern.");
      setItems((prev) => [...prev, { ...data.item, rotation: { urgency: "LOW", score: 0, reasons: [] } }]);
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(id: string, form: FormState) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/pantry/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(form)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Speichern.");
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...data.item } : it)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    await fetch(`/api/pantry/${id}`, { method: "DELETE" }).catch(() => {});
  }

  async function handleAdjust(item: PantryItemView, type: "add" | "consume", amount: number) {
    const res = await fetch(`/api/pantry/${item.id}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amount }),
    });
    const data = await res.json();
    if (res.ok) {
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, remainingQuantity: data.item.remainingQuantity } : it)));
    }
  }

  const isEmpty = items.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink-soft">Sortieren nach</span>
          <select
            className="rounded-full bg-bg-dim px-3 py-1.5 text-sm text-ink outline-none"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as "urgency" | "expiration")}
          >
            <option value="urgency">Dringlichkeit</option>
            <option value="expiration">Ablaufdatum</option>
          </select>
        </div>
        <button
          onClick={() => {
            setAdding((v) => !v);
            setEditingId(null);
          }}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
        >
          <Plus className="h-4 w-4" /> Item hinzufügen
        </button>
      </div>

      {error && <p className="mt-4 text-sm font-semibold text-primary">{error}</p>}

      {adding && (
        <div className="mt-6">
          <PantryForm initial={emptyForm()} onCancel={() => setAdding(false)} onSubmit={handleCreate} submitting={submitting} />
        </div>
      )}

      {isEmpty && !adding && (
        <p className="py-10 text-center text-sm text-ink-soft">
          Noch nichts in deiner Pantry. Füge dein erstes Lebensmittel hinzu.
        </p>
      )}

      {LOCATIONS.map((loc) => {
        const locItems = grouped.get(loc) ?? [];
        if (locItems.length === 0) return null;
        return (
          <div key={loc} className="mt-10">
            <h2 className="mb-3 text-[15px] font-bold tracking-tight text-ink">
              {PANTRY_LOCATION_LABELS[loc]} <span className="font-medium text-ink-soft">({locItems.length})</span>
            </h2>
            <div>
              {locItems.map((item) => (
                <div key={item.id}>
                  <div className="flex items-center gap-4 border-b border-border py-4">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: URGENCY_DOT[item.rotation.urgency] }}
                      title={item.rotation.reasons.join(" ") || "Keine besondere Dringlichkeit."}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15.5px] font-semibold text-ink">{item.name}</span>
                        {item.opened && <span className="rounded-full bg-bg-dim px-2 py-0.5 text-[11px] font-medium text-ink-soft">geöffnet</span>}
                        {item.cooked && <span className="rounded-full bg-bg-dim px-2 py-0.5 text-[11px] font-medium text-ink-soft">gekocht</span>}
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-ink-soft">
                        {formatQuantity(item.remainingQuantity)} / {formatQuantity(item.quantity)} {UNIT_LABELS[item.unit]}
                        {item.expirationDate && (
                          <>
                            {" · Ablauf "}
                            {formatDate(item.expirationDate)}
                            {item.expirationDateType === "ESTIMATED" && (
                              <span className="text-primary"> ({EXPIRATION_TYPE_LABELS.ESTIMATED})</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleAdjust(item, "consume", defaultStep(item.unit))}
                        aria-label="Menge reduzieren"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:text-ink"
                      >
                        −
                      </button>
                      <button
                        onClick={() => handleAdjust(item, "add", defaultStep(item.unit))}
                        aria-label="Menge erhöhen"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:text-ink"
                      >
                        +
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(editingId === item.id ? null : item.id);
                          setAdding(false);
                        }}
                        className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:text-ink"
                      >
                        Bearbeiten
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        aria-label="Löschen"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:text-primary"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {editingId === item.id && (
                    <div className="pb-4">
                      <PantryForm
                        initial={toForm(item)}
                        onCancel={() => setEditingId(null)}
                        onSubmit={(form) => handleUpdate(item.id, form)}
                        submitting={submitting}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
