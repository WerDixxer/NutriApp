"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, Dumbbell, Salad, Target, Trash2, User, Plus } from "lucide-react";
import { TagInput } from "@/components/TagInput";
import {
  ACTIVITY_LABELS,
  DIET_LABELS,
  GOAL_LABELS,
  SPORT_LABELS,
  WEEKDAY_LABELS,
} from "@/lib/labels";
import { MAX_RATE_KG_PER_WEEK } from "@/lib/nutrition";

type GoalKey = keyof typeof MAX_RATE_KG_PER_WEEK;

interface TrainingRow {
  weekday: number;
  startTime: string;
  durationMin: number;
  sportType: string;
  intensity: number;
}

const emptyTraining = (): TrainingRow => ({
  weekday: 0,
  startTime: "18:00",
  durationMin: 60,
  sportType: "STRENGTH",
  intensity: 3,
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      {children}
    </label>
  );
}

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
  delay = 0,
}: {
  icon: typeof User;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="flex flex-col gap-5 border-t border-border pt-8"
    >
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-ink-soft">{subtitle}</p>}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

const inputClass =
  "rounded-xl bg-bg-dim px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft/60";

export default function OnboardingForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [age, setAge] = useState(25);
  const [sex, setSex] = useState("MALE");
  const [heightCm, setHeightCm] = useState(180);
  const [weightKg, setWeightKg] = useState(75);
  const [activityLevel, setActivityLevel] = useState("MODERATE");
  const [goal, setGoal] = useState("MAINTAIN");
  const [goalRateKgPerWeek, setGoalRateKgPerWeek] = useState(0.5);
  const [sportType, setSportType] = useState("MIXED");
  const [dietType, setDietType] = useState("OMNIVORE");

  const [likedFoods, setLikedFoods] = useState<string[]>([]);
  const [dislikedFoods, setDislikedFoods] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);

  const [trainingSessions, setTrainingSessions] = useState<TrainingRow[]>([emptyTraining()]);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        const p = data.profile;
        if (!p) return;
        setAge(p.age);
        setSex(p.sex);
        setHeightCm(p.heightCm);
        setWeightKg(p.weightKg);
        setActivityLevel(p.activityLevel);
        setGoal(p.goal);
        setGoalRateKgPerWeek(p.goalRateKgPerWeek);
        setSportType(p.sportType);
        setDietType(p.dietType);
        setLikedFoods(p.likedFoods.map((t: { label: string }) => t.label));
        setDislikedFoods(p.dislikedFoods.map((t: { label: string }) => t.label));
        setAllergies(p.allergies.map((t: { label: string }) => t.label));
        setPriorities(p.priorities.map((t: { label: string }) => t.label));
        if (p.trainingSessions.length > 0) {
          setTrainingSessions(
            p.trainingSessions.map(
              (s: {
                weekday: number;
                startTime: string;
                durationMin: number;
                sportType: string;
                intensity: number;
              }) => ({
                weekday: s.weekday,
                startTime: s.startTime,
                durationMin: s.durationMin,
                sportType: s.sportType,
                intensity: s.intensity,
              }),
            ),
          );
        }
      })
      .catch(() => {});
  }, []);

  function updateTraining(index: number, patch: Partial<TrainingRow>) {
    setTrainingSessions((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          age,
          sex,
          heightCm,
          weightKg,
          activityLevel,
          goal,
          goalRateKgPerWeek,
          sportType,
          dietType,
          likedFoods,
          dislikedFoods,
          allergies,
          priorities,
          trainingSessions,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Fehler beim Speichern.");
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-16">
      <SectionCard icon={User} title="Über dich" subtitle="Basis für deine Kalorienberechnung">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Alter">
            <input
              className={inputClass}
              type="number"
              min={10}
              max={100}
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Geschlecht">
            <select className={inputClass} value={sex} onChange={(e) => setSex(e.target.value)}>
              <option value="MALE">Männlich</option>
              <option value="FEMALE">Weiblich</option>
            </select>
          </Field>
          <Field label="Größe (cm)">
            <input
              className={inputClass}
              type="number"
              min={100}
              max={250}
              value={heightCm}
              onChange={(e) => setHeightCm(Number(e.target.value))}
              required
            />
          </Field>
          <Field label="Gewicht (kg)">
            <input
              className={inputClass}
              type="number"
              min={30}
              max={300}
              step={0.1}
              value={weightKg}
              onChange={(e) => setWeightKg(Number(e.target.value))}
              required
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        icon={Target}
        title="Ziel & Aktivität"
        subtitle="Bestimmt dein Kalorien- und Makroziel"
        delay={0.05}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Alltagsaktivität">
            <select
              className={inputClass}
              value={activityLevel}
              onChange={(e) => setActivityLevel(e.target.value)}
            >
              {Object.entries(ACTIVITY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ziel">
            <select
              className={inputClass}
              value={goal}
              onChange={(e) => {
                const nextGoal = e.target.value as GoalKey;
                setGoal(nextGoal);
                const max = MAX_RATE_KG_PER_WEEK[nextGoal];
                if (goalRateKgPerWeek > max) setGoalRateKgPerWeek(max);
              }}
            >
              {Object.entries(GOAL_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          {goal !== "MAINTAIN" && (
            <Field label="Tempo (kg pro Woche)">
              <input
                className={inputClass}
                type="number"
                min={0.1}
                max={MAX_RATE_KG_PER_WEEK[goal as GoalKey]}
                step={0.05}
                value={goalRateKgPerWeek}
                onChange={(e) =>
                  setGoalRateKgPerWeek(
                    Math.min(Number(e.target.value), MAX_RATE_KG_PER_WEEK[goal as GoalKey]),
                  )
                }
              />
              <span className="text-xs text-ink-soft">
                {goal === "GAIN_MUSCLE"
                  ? `Realistisches Maximum für sauberen Muskelaufbau: ${MAX_RATE_KG_PER_WEEK.GAIN_MUSCLE} kg/Woche. Schneller ist überwiegend Fettaufbau.`
                  : `Maximal empfohlen: ${MAX_RATE_KG_PER_WEEK[goal as GoalKey]} kg/Woche.`}
              </span>
            </Field>
          )}
          <Field label="Sportart (Schwerpunkt)">
            <select
              className={inputClass}
              value={sportType}
              onChange={(e) => setSportType(e.target.value)}
            >
              {Object.entries(SPORT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        icon={Salad}
        title="Ernährung"
        subtitle="Damit dir nie etwas vorgeschlagen wird, das du nicht essen kannst oder willst"
        delay={0.1}
      >
        <Field label="Ernährungsform">
          <select
            className={inputClass}
            value={dietType}
            onChange={(e) => setDietType(e.target.value)}
          >
            {Object.entries(DIET_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lieblingsessen">
          <TagInput
            values={likedFoods}
            onChange={setLikedFoods}
            placeholder="Eingeben + Enter, z.B. Hähnchen, Reis…"
            chipClassName="bg-primary-soft text-primary-dark"
          />
        </Field>
        <Field label="Magst du nicht">
          <TagInput
            values={dislikedFoods}
            onChange={setDislikedFoods}
            placeholder="Eingeben + Enter, z.B. Pilze, Rosenkohl…"
            chipClassName="bg-bg text-ink-soft"
          />
        </Field>
        <Field label="Allergien / Unverträglichkeiten">
          <TagInput
            values={allergies}
            onChange={setAllergies}
            placeholder="Eingeben + Enter, z.B. Nüsse, Laktose…"
            chipClassName="bg-accent-soft text-accent"
          />
        </Field>
        <Field label="Was dir wichtig ist">
          <TagInput
            values={priorities}
            onChange={setPriorities}
            placeholder="Eingeben + Enter, z.B. günstig, viel Protein…"
            chipClassName="bg-amber-100 text-amber-700"
          />
        </Field>
      </SectionCard>

      <SectionCard
        icon={Dumbbell}
        title="Trainingseinheiten"
        subtitle="Damit Mahlzeiten-Timing (Carbs vorher, Protein danach) berücksichtigt wird"
        delay={0.15}
      >
        <div className="flex flex-col gap-3">
          {trainingSessions.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-2 gap-3 rounded-2xl bg-bg-dim p-4 sm:grid-cols-5 sm:items-end"
            >
              <Field label="Wochentag">
                <select
                  className={inputClass}
                  value={row.weekday}
                  onChange={(e) => updateTraining(i, { weekday: Number(e.target.value) })}
                >
                  {WEEKDAY_LABELS.map((label, idx) => (
                    <option key={idx} value={idx}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Startzeit">
                <input
                  className={inputClass}
                  type="time"
                  value={row.startTime}
                  onChange={(e) => updateTraining(i, { startTime: e.target.value })}
                />
              </Field>
              <Field label="Dauer (min)">
                <input
                  className={inputClass}
                  type="number"
                  min={10}
                  max={240}
                  value={row.durationMin}
                  onChange={(e) => updateTraining(i, { durationMin: Number(e.target.value) })}
                />
              </Field>
              <Field label="Sportart">
                <select
                  className={inputClass}
                  value={row.sportType}
                  onChange={(e) => updateTraining(i, { sportType: e.target.value })}
                >
                  {Object.entries(SPORT_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end gap-2">
                <Field label="Intensität (1-5)">
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={5}
                    value={row.intensity}
                    onChange={(e) => updateTraining(i, { intensity: Number(e.target.value) })}
                  />
                </Field>
                <button
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:text-primary"
                  onClick={() => setTrainingSessions((rows) => rows.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1.5 rounded-full bg-bg-dim px-4 py-2 text-sm font-semibold text-ink transition hover:bg-primary-soft hover:text-primary-dark"
            onClick={() => setTrainingSessions((rows) => [...rows, emptyTraining()])}
          >
            <Plus className="h-4 w-4" /> Einheit hinzufügen
          </button>
        </div>
      </SectionCard>

      {error && <p className="text-sm font-semibold text-primary">{error}</p>}

      <motion.button
        whileTap={{ scale: 0.98 }}
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50"
      >
        <Activity className="h-4 w-4" />
        {submitting ? "Speichern…" : "Speichern & Plan erstellen"}
      </motion.button>
    </form>
  );
}
