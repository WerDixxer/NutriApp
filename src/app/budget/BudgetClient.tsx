"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2 } from "lucide-react";
import { formatCents } from "@/lib/budget/money";
import { BUDGET_PERIOD_LABELS, BUDGET_STATUS_LABELS, FOOD_EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export interface BudgetSummaryView {
  budgetId: string;
  periodType: "WEEK" | "MONTH";
  currency: string;
  budgetAmountCents: number;
  spentAmountCents: number;
  remainingAmountCents: number;
  spentPercentage: number;
  status: "UNDER_BUDGET" | "NEAR_LIMIT" | "OVER_BUDGET";
  periodStart: string;
  periodEnd: string;
}

export interface ExpenseView {
  id: string;
  amountCents: number;
  currency: string;
  date: string;
  category: string;
  source: string | null;
  description: string | null;
}

const PERIOD_TYPES: Array<"WEEK" | "MONTH"> = ["WEEK", "MONTH"];
const SET_BUDGET_LABELS: Record<"WEEK" | "MONTH", string> = {
  WEEK: "Wochenbudget setzen",
  MONTH: "Monatsbudget setzen",
};
const CATEGORIES = Object.keys(FOOD_EXPENSE_CATEGORY_LABELS);

const STATUS_COLOR: Record<string, string> = {
  UNDER_BUDGET: "var(--color-success)",
  NEAR_LIMIT: "var(--color-warn-dot)",
  OVER_BUDGET: "var(--color-danger)",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateRange(startIso: string, endIso: string): string {
  return `${formatDate(startIso)} – ${formatDate(endIso)}`;
}

function BudgetAmountForm({
  initialAmount,
  onCancel,
  onSubmit,
  submitting,
}: {
  initialAmount: string;
  onCancel: () => void;
  onSubmit: (amount: string) => void;
  submitting: boolean;
}) {
  const [amount, setAmount] = useState(initialAmount);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(amount);
      }}
      className="mt-4 flex items-center gap-3"
    >
      <Input
        type="number"
        step="0.01"
        min={0.01}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="z.B. 60"
        required
        autoFocus
        className="w-32"
      />
      <Button type="submit" size="sm" disabled={submitting}>
        Speichern
      </Button>
      <button type="button" onClick={onCancel} className="text-xs font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink">
        Abbrechen
      </button>
    </form>
  );
}

function BudgetPeriodCard({
  periodType,
  summary,
  onSet,
  onUpdate,
  onDelete,
  submitting,
}: {
  periodType: "WEEK" | "MONTH";
  summary: BudgetSummaryView | undefined;
  onSet: (amount: string) => void;
  onUpdate: (amount: string) => void;
  onDelete: () => void;
  submitting: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (!summary) {
    return (
      <Card className="p-6">
        <h2 className="text-h3 text-ink">{BUDGET_PERIOD_LABELS[periodType]}</h2>
        <p className="text-body mt-1 text-ink-soft">Noch kein Budget gesetzt.</p>
        {editing ? (
          <BudgetAmountForm
            initialAmount=""
            onCancel={() => setEditing(false)}
            onSubmit={(amount) => {
              onSet(amount);
              setEditing(false);
            }}
            submitting={submitting}
          />
        ) : (
          <Button size="sm" onClick={() => setEditing(true)} className="mt-4">
            <Plus className="h-3.5 w-3.5" /> {SET_BUDGET_LABELS[periodType]}
          </Button>
        )}
      </Card>
    );
  }

  const pct = Math.max(0, Math.min(100, summary.spentPercentage));

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h3 text-ink">{BUDGET_PERIOD_LABELS[periodType]}</h2>
          <p className="num mt-0.5 text-[12px] font-medium text-ink-faint">{formatDateRange(summary.periodStart, summary.periodEnd)}</p>
        </div>
        <button
          onClick={onDelete}
          aria-label="Budget löschen"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-primary"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 flex items-baseline gap-2">
        <span className="num font-display text-[28px] text-ink">{formatCents(summary.spentAmountCents, summary.currency)}</span>
        <span className="text-[14px] text-ink-soft">von {formatCents(summary.budgetAmountCents, summary.currency)}</span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg">
        <motion.div
          className="h-full rounded-full"
          style={{ background: STATUS_COLOR[summary.status] }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-xs font-semibold">
        <span style={{ color: STATUS_COLOR[summary.status] }}>{BUDGET_STATUS_LABELS[summary.status]}</span>
        <span className="num text-ink-soft">
          {summary.remainingAmountCents >= 0
            ? `${formatCents(summary.remainingAmountCents, summary.currency)} übrig`
            : `${formatCents(-summary.remainingAmountCents, summary.currency)} über dem Budget`}
        </span>
      </div>

      {editing ? (
        <BudgetAmountForm
          initialAmount={String(summary.budgetAmountCents / 100)}
          onCancel={() => setEditing(false)}
          onSubmit={(amount) => {
            onUpdate(amount);
            setEditing(false);
          }}
          submitting={submitting}
        />
      ) : (
        <button onClick={() => setEditing(true)} className="mt-4 text-xs font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink">
          Betrag ändern
        </button>
      )}
    </Card>
  );
}

interface ExpenseFormState {
  amount: string;
  date: string;
  category: string;
  source: string;
  description: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyExpenseForm(): ExpenseFormState {
  return { amount: "", date: todayIso(), category: "GROCERIES", source: "", description: "" };
}

function expenseToForm(expense: ExpenseView): ExpenseFormState {
  return {
    amount: String(expense.amountCents / 100),
    date: expense.date.slice(0, 10),
    category: expense.category,
    source: expense.source ?? "",
    description: expense.description ?? "",
  };
}

function ExpenseForm({
  initial,
  onCancel,
  onSubmit,
  submitting,
}: {
  initial: ExpenseFormState;
  onCancel: () => void;
  onSubmit: (form: ExpenseFormState) => void;
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Betrag (€)</span>
          <Input
            type="number"
            step="0.01"
            min={0.01}
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Datum</span>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Kategorie</span>
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {FOOD_EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-ink">Ort (optional)</span>
          <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="z.B. Supermarkt" />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold text-ink">Notiz (optional)</span>
        <Input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="z.B. Wocheneinkauf"
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

function ExpenseRow({
  expense,
  isEditing,
  onToggleEdit,
  onDelete,
  onUpdate,
  submitting,
}: {
  expense: ExpenseView;
  isEditing: boolean;
  onToggleEdit: () => void;
  onDelete: () => void;
  onUpdate: (form: ExpenseFormState) => void;
  submitting: boolean;
}) {
  return (
    <div>
      <div className="flex min-h-[76px] items-center gap-4 border-b border-border py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-[15.5px] font-semibold text-ink">{formatCents(expense.amountCents, expense.currency)}</span>
            <span className="rounded-full bg-bg-dim px-2 py-0.5 text-[11px] font-medium text-ink-soft">
              {FOOD_EXPENSE_CATEGORY_LABELS[expense.category]}
            </span>
          </div>
          <div className="num mt-0.5 text-[12px] font-medium text-ink-soft">
            {formatDate(expense.date)}
            {expense.source && <>, {expense.source}</>}
            {expense.description && <>, {expense.description}</>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onToggleEdit} className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink">
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
          <ExpenseForm initial={expenseToForm(expense)} onCancel={onToggleEdit} onSubmit={onUpdate} submitting={submitting} />
        </div>
      )}
    </div>
  );
}

export default function BudgetClient({
  initialSummary,
  initialExpenses,
}: {
  initialSummary: BudgetSummaryView[];
  initialExpenses: ExpenseView[];
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byPeriod = new Map(summary.map((s) => [s.periodType, s]));

  async function refreshSummary() {
    const res = await fetch("/api/budget/summary");
    if (res.ok) {
      const data = await res.json();
      setSummary(data.summary);
    }
  }

  async function handleSetBudget(periodType: "WEEK" | "MONTH", amount: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodType, amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Speichern.");
      await refreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateBudget(budgetId: string, amount: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/budget/${budgetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Speichern.");
      await refreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteBudget(budgetId: string) {
    setSummary((prev) => prev.filter((s) => s.budgetId !== budgetId));
    await fetch(`/api/budget/${budgetId}`, { method: "DELETE" }).catch(() => {});
  }

  function expenseToPayload(form: ExpenseFormState) {
    return {
      amount: Number(form.amount),
      date: form.date,
      category: form.category,
      source: form.source || undefined,
      description: form.description || undefined,
    };
  }

  async function handleCreateExpense(form: ExpenseFormState) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/budget/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expenseToPayload(form)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Speichern.");
      setExpenses((prev) => [data.expense, ...prev]);
      setAdding(false);
      await refreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateExpense(id: string, form: ExpenseFormState) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/budget/expenses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expenseToPayload(form)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler beim Speichern.");
      setExpenses((prev) => prev.map((e) => (e.id === id ? data.expense : e)));
      setEditingId(null);
      await refreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteExpense(id: string) {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    await fetch(`/api/budget/expenses/${id}`, { method: "DELETE" }).catch(() => {});
    await refreshSummary();
  }

  return (
    <div>
      {error && <p className="mb-4 text-[13.5px] font-semibold text-danger">{error}</p>}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {PERIOD_TYPES.map((periodType) => (
          <BudgetPeriodCard
            key={periodType}
            periodType={periodType}
            summary={byPeriod.get(periodType)}
            onSet={(amount) => handleSetBudget(periodType, amount)}
            onUpdate={(amount) => {
              const s = byPeriod.get(periodType);
              if (s) handleUpdateBudget(s.budgetId, amount);
            }}
            onDelete={() => {
              const s = byPeriod.get(periodType);
              if (s) handleDeleteBudget(s.budgetId);
            }}
            submitting={submitting}
          />
        ))}
      </div>

      <div className="mt-10 flex items-center justify-between border-b border-border pb-6">
        <h2 className="text-h3 text-ink">
          Ausgaben <span className="text-label font-medium text-ink-faint">({expenses.length})</span>
        </h2>
        <Button
          size="sm"
          onClick={() => {
            setAdding((v) => !v);
            setEditingId(null);
          }}
        >
          <Plus className="h-4 w-4" /> Ausgabe erfassen
        </Button>
      </div>

      {adding && (
        <div className="mt-6">
          <ExpenseForm initial={emptyExpenseForm()} onCancel={() => setAdding(false)} onSubmit={handleCreateExpense} submitting={submitting} />
        </div>
      )}

      {expenses.length === 0 && !adding && (
        <div className="py-10">
          <EmptyState title="Noch keine Ausgaben erfasst" description="Trag deinen ersten Einkauf ein, dann behalten wir dein Budget für dich im Blick." />
        </div>
      )}

      <div className="mt-2">
        {expenses.map((expense) => (
          <ExpenseRow
            key={expense.id}
            expense={expense}
            isEditing={editingId === expense.id}
            onToggleEdit={() => {
              setEditingId(editingId === expense.id ? null : expense.id);
              setAdding(false);
            }}
            onDelete={() => handleDeleteExpense(expense.id)}
            onUpdate={(form) => handleUpdateExpense(expense.id, form)}
            submitting={submitting}
          />
        ))}
      </div>
    </div>
  );
}
