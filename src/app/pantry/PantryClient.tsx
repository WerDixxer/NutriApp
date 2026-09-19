"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PANTRY_LOCATION_LABELS, EXPIRATION_TYPE_LABELS } from "@/lib/labels";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export interface PantryRotationView {
  pantryItemId: string;
  priorityScore: number;
  urgency: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  reasons: string[];
  warnings: string[];
  recommendedAction: "USE_FIRST" | "USE_SOON" | "PLAN_MEAL" | "KEEP" | "CHECK" | "NO_ACTION";
}

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
  rotation: PantryRotationView;
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
  CRITICAL: "var(--color-primary)",
  HIGH: "var(--color-primary)",
  MEDIUM: "var(--color-warn-dot)",
  LOW: "var(--color-border)",
  UNKNOWN: "var(--color-border)",
};

const RECOMMENDED_ACTION_LABELS: Record<string, string> = {
  USE_FIRST: "Zuerst verbrauchen",
  USE_SOON: "Bald verbrauchen",
  PLAN_MEAL: "Bald einplanen",
  CHECK: "Bitte prüfen",
  KEEP: "Vorrätig",
  NO_ACTION: "",
};

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
      className="flex flex-col gap-4 rounded-[var(--radius-md)] bg-bg-dim p-5"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Name</span>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="z.B. Hähnchenbrust"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Kategorie (optional)</span>
          <Input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="z.B. Fleisch"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Menge</span>
          <Input
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
          <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {Object.entries(UNIT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Lagerort</span>
          <Select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
            {LOCATIONS.map((v) => (
              <option key={v} value={v}>
                {PANTRY_LOCATION_LABELS[v]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Gekauft am</span>
          <Input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Ablaufdatum-Typ</span>
          <Select
            value={form.expirationKnown}
            onChange={(e) => {
              const next = e.target.value as FormState["expirationKnown"];
              setForm({ ...form, expirationKnown: next, expirationDate: next === "UNKNOWN" ? "" : form.expirationDate });
            }}
          >
            <option value="UNKNOWN">Kein Ablaufdatum</option>
            <option value="EXACT">Genaues Datum</option>
            <option value="ESTIMATED">Geschätztes Datum</option>
          </Select>
        </label>
        {form.expirationKnown !== "UNKNOWN" && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold text-ink">Ablaufdatum</span>
            <Input
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
        <Textarea
          className="min-h-[60px] resize-y"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </label>

      <div className="flex items-center gap-4">
        <Button type="submit" size="sm" disabled={submitting}>
          Speichern
        </Button>
        <button type="button" onClick={onCancel} className="text-[13px] font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink">
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

function PantryItemRow({
  item,
  isEditing,
  onAdjust,
  onToggleEdit,
  onDelete,
  onUpdate,
  submitting,
  spotlight = false,
}: {
  item: PantryItemView;
  isEditing: boolean;
  onAdjust: (type: "add" | "consume", amount: number) => void;
  onToggleEdit: () => void;
  onDelete: () => void;
  onUpdate: (form: FormState) => void;
  submitting: boolean;
  /** In den "Zuerst verbrauchen"/"Bald einplanen"-Bereichen: Lagerort + Begründung zusätzlich sichtbar machen. */
  spotlight?: boolean;
}) {
  const actionLabel = RECOMMENDED_ACTION_LABELS[item.rotation.recommendedAction];
  const explanation = item.rotation.warnings[0] ?? item.rotation.reasons.join(" ");

  return (
    <div>
      <div className="flex min-h-[76px] items-center gap-4 border-b border-border py-4">
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
            {spotlight && actionLabel && (
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-dark">{actionLabel}</span>
            )}
          </div>
          <div className="num mt-0.5 text-[12px] font-medium text-ink-soft">
            {formatQuantity(item.remainingQuantity)} / {formatQuantity(item.quantity)} {UNIT_LABELS[item.unit]}
            {spotlight && <>, {PANTRY_LOCATION_LABELS[item.location]}</>}
            {item.expirationDate && (
              <>
                {", Ablauf "}
                {formatDate(item.expirationDate)}
                {item.expirationDateType === "ESTIMATED" && (
                  <span className="text-warn"> ({EXPIRATION_TYPE_LABELS.ESTIMATED})</span>
                )}
              </>
            )}
          </div>
          {spotlight && explanation && <div className="mt-1 text-[12px] text-ink-soft">{explanation}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onAdjust("consume", defaultStep(item.unit))}
            aria-label="Menge reduzieren"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors duration-[var(--duration-fast)] hover:bg-bg-dim hover:text-ink"
          >
            −
          </button>
          <button
            onClick={() => onAdjust("add", defaultStep(item.unit))}
            aria-label="Menge erhöhen"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors duration-[var(--duration-fast)] hover:bg-bg-dim hover:text-ink"
          >
            +
          </button>
          <button
            onClick={onToggleEdit}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink"
          >
            Bearbeiten
          </button>
          <button
            onClick={onDelete}
            aria-label="Löschen"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-primary"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {isEditing && (
        <div className="pb-4">
          <PantryForm initial={toForm(item)} onCancel={onToggleEdit} onSubmit={onUpdate} submitting={submitting} />
        </div>
      )}
    </div>
  );
}

export default function PantryClient({
  initialItems,
  useFirstIds,
  planMealIds,
}: {
  initialItems: PantryItemView[];
  useFirstIds: string[];
  planMealIds: string[];
}) {
  const [items, setItems] = useState(initialItems);
  const [sortMode, setSortMode] = useState<"urgency" | "expiration">("urgency");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      if (sortMode === "urgency") return b.rotation.priorityScore - a.rotation.priorityScore;
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

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const useFirstItems = useFirstIds.map((id) => byId.get(id)).filter((i): i is PantryItemView => !!i);
  const planMealItems = planMealIds.map((id) => byId.get(id)).filter((i): i is PantryItemView => !!i);

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
      const placeholderRotation: PantryRotationView = {
        pantryItemId: data.item.id,
        priorityScore: 0,
        urgency: "UNKNOWN",
        reasons: [],
        warnings: [],
        recommendedAction: "NO_ACTION",
      };
      setItems((prev) => [...prev, { ...data.item, rotation: placeholderRotation }]);
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
        <div className="flex items-center gap-2 text-[13.5px]">
          <span className="font-semibold text-ink-soft">Sortieren nach</span>
          <select
            className="rounded-full bg-bg-dim px-3 py-1.5 text-[13.5px] text-ink outline-none"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as "urgency" | "expiration")}
          >
            <option value="urgency">Dringlichkeit</option>
            <option value="expiration">Ablaufdatum</option>
          </select>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setAdding((v) => !v);
            setEditingId(null);
          }}
        >
          <Plus className="h-4 w-4" /> Item hinzufügen
        </Button>
      </div>

      {error && <p className="mt-4 text-[13.5px] font-semibold text-danger">{error}</p>}

      {adding && (
        <div className="mt-6">
          <PantryForm initial={emptyForm()} onCancel={() => setAdding(false)} onSubmit={handleCreate} submitting={submitting} />
        </div>
      )}

      {isEmpty && !adding && (
        <div className="py-10">
          <EmptyState
            title="Noch nichts in deiner Pantry"
            description="Füge dein erstes Lebensmittel hinzu. Wir berücksichtigen es sofort bei deinem Plan."
          />
        </div>
      )}

      {useFirstItems.length > 0 && (
        <div className="mt-10">
          <h2 className="text-h3 mb-3 text-ink">
            Zuerst verbrauchen <span className="text-label font-medium text-ink-faint">({useFirstItems.length})</span>
          </h2>
          <div>
            {useFirstItems.map((item) => (
              <PantryItemRow
                key={item.id}
                item={item}
                spotlight
                isEditing={editingId === item.id}
                onAdjust={(type, amount) => handleAdjust(item, type, amount)}
                onToggleEdit={() => {
                  setEditingId(editingId === item.id ? null : item.id);
                  setAdding(false);
                }}
                onDelete={() => handleDelete(item.id)}
                onUpdate={(form) => handleUpdate(item.id, form)}
                submitting={submitting}
              />
            ))}
          </div>
        </div>
      )}

      {planMealItems.length > 0 && (
        <div className="mt-10">
          <h2 className="text-h3 mb-3 text-ink">
            Bald einplanen <span className="text-label font-medium text-ink-faint">({planMealItems.length})</span>
          </h2>
          <div>
            {planMealItems.map((item) => (
              <PantryItemRow
                key={item.id}
                item={item}
                spotlight
                isEditing={editingId === item.id}
                onAdjust={(type, amount) => handleAdjust(item, type, amount)}
                onToggleEdit={() => {
                  setEditingId(editingId === item.id ? null : item.id);
                  setAdding(false);
                }}
                onDelete={() => handleDelete(item.id)}
                onUpdate={(form) => handleUpdate(item.id, form)}
                submitting={submitting}
              />
            ))}
          </div>
        </div>
      )}

      {LOCATIONS.map((loc) => {
        const locItems = grouped.get(loc) ?? [];
        if (locItems.length === 0) return null;
        return (
          <div key={loc} className="mt-10">
            <h2 className="text-h3 mb-3 text-ink">
              {PANTRY_LOCATION_LABELS[loc]} <span className="text-label font-medium text-ink-faint">({locItems.length})</span>
            </h2>
            <div>
              {locItems.map((item) => (
                <PantryItemRow
                  key={item.id}
                  item={item}
                  isEditing={editingId === item.id}
                  onAdjust={(type, amount) => handleAdjust(item, type, amount)}
                  onToggleEdit={() => {
                    setEditingId(editingId === item.id ? null : item.id);
                    setAdding(false);
                  }}
                  onDelete={() => handleDelete(item.id)}
                  onUpdate={(form) => handleUpdate(item.id, form)}
                  submitting={submitting}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
