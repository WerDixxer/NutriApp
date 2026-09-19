"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChefHat } from "lucide-react";
import { TagInput } from "@/components/TagInput";
import { Input, Textarea } from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/Button";
import { DIET_LABELS, SLOT_LABELS } from "@/lib/labels";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      {children}
    </label>
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
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Omas Linsensuppe"
              required
            />
          </Field>
          <Field label="Kurzbeschreibung">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ein Satz zum Gericht"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Kalorien (kcal)">
            <Input
              type="number"
              min={0}
              value={kcal}
              onChange={(e) => setKcal(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Protein (g)">
            <Input type="number" min={0} value={proteinG} onChange={(e) => setProteinG(Number(e.target.value))} />
          </Field>
          <Field label="Carbs (g)">
            <Input type="number" min={0} value={carbsG} onChange={(e) => setCarbsG(Number(e.target.value))} />
          </Field>
          <Field label="Fett (g)">
            <Input type="number" min={0} value={fatG} onChange={(e) => setFatG(Number(e.target.value))} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Zubereitungszeit (Min.)">
            <Input type="number" min={1} value={prepTimeMin} onChange={(e) => setPrepTimeMin(Number(e.target.value))} />
          </Field>
          <Field label="Portionen">
            <Input type="number" min={1} value={servings} onChange={(e) => setServings(Number(e.target.value))} />
          </Field>
        </div>

        <Field label="Passt als...">
          <div className="flex flex-wrap gap-2">
            {Object.entries(SLOT_LABELS).map(([key, label]) => (
              <Pill
                key={key}
                active={mealSlots.includes(key)}
                onClick={() => toggle(mealSlots, setMealSlots, key, !mealSlots.includes(key))}
              >
                {label}
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="Passt zu diesen Ernährungsformen">
          <div className="flex flex-wrap gap-2">
            {Object.entries(DIET_LABELS).map(([key, label]) => (
              <Pill
                key={key}
                active={dietTypes.includes(key)}
                onClick={() => toggle(dietTypes, setDietTypes, key, !dietTypes.includes(key))}
              >
                {label}
              </Pill>
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
          <Textarea
            className="min-h-[120px] resize-y font-mono text-xs"
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
            placeholder={"200 g Hüttenkäse\n1 EL Honig\n80 g Beeren"}
          />
        </Field>

        <Field label="Zubereitung, ein Schritt pro Zeile">
          <Textarea
            className="min-h-[140px] resize-y text-sm"
            value={instructionsText}
            onChange={(e) => setInstructionsText(e.target.value)}
            placeholder={"Hüttenkäse in eine Schale geben.\nBeeren waschen und darüber verteilen.\n..."}
          />
        </Field>
      </div>

      {error && <p className="text-[13.5px] font-semibold text-danger">{error}</p>}

      <Button type="submit" disabled={submitting}>
        <ChefHat className="h-4 w-4" />
        {submitting ? "Speichern…" : "Rezept speichern"}
      </Button>
    </motion.form>
  );
}
