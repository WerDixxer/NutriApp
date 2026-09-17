"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChefHat } from "lucide-react";
import { TagInput } from "@/components/TagInput";
import { DIET_LABELS, SLOT_LABELS } from "@/lib/labels";

const inputClass =
  "rounded-xl bg-bg-dim px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft/60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}

function CheckboxChip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
        checked ? "bg-ink text-white" : "bg-bg-dim text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

export default function NewRecipeForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kcal, setKcal] = useState(500);
  const [proteinG, setProteinG] = useState(30);
  const [carbsG, setCarbsG] = useState(50);
  const [fatG, setFatG] = useState(15);
  const [prepTimeMin, setPrepTimeMin] = useState(20);
  const [servings, setServings] = useState(1);
  const [mealSlots, setMealSlots] = useState<string[]>(["LUNCH", "DINNER"]);
  const [dietTypes, setDietTypes] = useState<string[]>(["OMNIVORE"]);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [ingredientsText, setIngredientsText] = useState("");
  const [instructionsText, setInstructionsText] = useState("");

  function toggle(list: string[], setList: (v: string[]) => void, key: string, checked: boolean) {
    setList(checked ? [...list, key] : list.filter((v) => v !== key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const ingredients = ingredientsText.split("\n").map((l) => l.trim()).filter(Boolean);
    const instructions = instructionsText.split("\n").map((l) => l.trim()).filter(Boolean);

    if (mealSlots.length === 0) return setError("Wähle mindestens eine Mahlzeit-Kategorie.");
    if (dietTypes.length === 0) return setError("Wähle mindestens eine passende Ernährungsform.");
    if (ingredients.length === 0) return setError("Trag mindestens eine Zutat ein.");
    if (instructions.length === 0) return setError("Trag mindestens einen Zubereitungsschritt ein.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          kcal,
          proteinG,
          carbsG,
          fatG,
          prepTimeMin,
          servings,
          mealSlots,
          dietTypes,
          allergens,
          tags,
          ingredients,
          instructions,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Fehler beim Speichern.");
      }
      router.push("/recipes");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 pb-16"
    >
      <div className="flex flex-col gap-6 border-t border-border pt-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name des Gerichts">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Omas Linsensuppe"
              required
            />
          </Field>
          <Field label="Kurzbeschreibung">
            <input
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ein Satz zum Gericht"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Kalorien (kcal)">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={kcal}
              onChange={(e) => setKcal(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Protein (g)">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={proteinG}
              onChange={(e) => setProteinG(Number(e.target.value))}
            />
          </Field>
          <Field label="Carbs (g)">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={carbsG}
              onChange={(e) => setCarbsG(Number(e.target.value))}
            />
          </Field>
          <Field label="Fett (g)">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={fatG}
              onChange={(e) => setFatG(Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Zubereitungszeit (Min.)">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={prepTimeMin}
              onChange={(e) => setPrepTimeMin(Number(e.target.value))}
            />
          </Field>
          <Field label="Portionen">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={servings}
              onChange={(e) => setServings(Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label="Passt als...">
          <div className="flex flex-wrap gap-2">
            {Object.entries(SLOT_LABELS).map(([key, label]) => (
              <CheckboxChip
                key={key}
                label={label}
                checked={mealSlots.includes(key)}
                onChange={(c) => toggle(mealSlots, setMealSlots, key, c)}
              />
            ))}
          </div>
        </Field>

        <Field label="Passt zu diesen Ernährungsformen">
          <div className="flex flex-wrap gap-2">
            {Object.entries(DIET_LABELS).map(([key, label]) => (
              <CheckboxChip
                key={key}
                label={label}
                checked={dietTypes.includes(key)}
                onChange={(c) => toggle(dietTypes, setDietTypes, key, c)}
              />
            ))}
          </div>
        </Field>

        <Field label="Enthaltene Allergene (optional)">
          <TagInput
            values={allergens}
            onChange={setAllergens}
            placeholder="Eingeben + Enter, z.B. Gluten, Nüsse…"
            chipClassName="bg-accent-soft text-accent"
          />
        </Field>

        <Field label="Tags (optional, z.B. vegan, airfryer, meal-prep)">
          <TagInput
            values={tags}
            onChange={setTags}
            placeholder="Eingeben + Enter, z.B. airfryer…"
            chipClassName="bg-primary-soft text-primary-dark"
          />
        </Field>

        <Field label="Zutaten, eine pro Zeile, mit Menge">
          <textarea
            className={`${inputClass} min-h-[120px] resize-y font-mono text-xs`}
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
            placeholder={"200 g Hüttenkäse\n1 EL Honig\n80 g Beeren"}
          />
        </Field>

        <Field label="Zubereitung, ein Schritt pro Zeile">
          <textarea
            className={`${inputClass} min-h-[140px] resize-y text-sm`}
            value={instructionsText}
            onChange={(e) => setInstructionsText(e.target.value)}
            placeholder={"Hüttenkäse in eine Schale geben.\nBeeren waschen und darüber verteilen.\n..."}
          />
        </Field>
      </div>

      {error && <p className="text-sm font-semibold text-primary">{error}</p>}

      <motion.button
        whileTap={{ scale: 0.98 }}
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50"
      >
        <ChefHat className="h-4 w-4" />
        {submitting ? "Speichern…" : "Rezept speichern"}
      </motion.button>
    </motion.form>
  );
}
