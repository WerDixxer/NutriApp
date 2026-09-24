import { Apple, ChefHat, Dumbbell, Sunrise, Utensils, Zap, type LucideIcon } from "lucide-react";
import { RECIPE_TYPES, type RecipeTypeIcon as RecipeTypeIconName, type RecipeTypeKey } from "@/lib/recipes/recipeType";

/**
 * Vorläufiges Icon-System des Rezeptkatalogs: vorhandene lucide-Icons, gewählt über den
 * abgeleiteten Rezepttyp (lib/recipes/recipeType.ts). Später durch ein eigenes Good-Order-Iconset
 * ersetzbar, ohne dass Karten oder Ableitung angefasst werden müssen.
 */
export const RECIPE_TYPE_ICONS: Record<RecipeTypeIconName, LucideIcon> = {
  Sunrise,
  Utensils,
  Apple,
  Zap,
  Dumbbell,
  ChefHat,
};

/** Dezente Flächen aus den bestehenden, gedeckten Design-Tokens. */
export const RECIPE_TYPE_TONES: Record<RecipeTypeKey, string> = {
  breakfast: "var(--color-warn-soft)",
  meal: "var(--color-primary-soft)",
  snack: "var(--color-accent-soft)",
  "pre-workout": "var(--color-danger-soft)",
  "post-workout": "var(--color-bg-dim)",
  other: "var(--color-bg-dim)",
};

/** Nur das Icon des Rezepttyps (z. B. groß im Detail-Dialog); dekorativ, der Typ steht immer auch als Text daneben. */
export function RecipeTypeIcon({ type, className = "", strokeWidth = 1.75 }: { type: RecipeTypeKey; className?: string; strokeWidth?: number }) {
  const Icon = RECIPE_TYPE_ICONS[RECIPE_TYPES[type].icon];
  return <Icon aria-hidden="true" className={className} strokeWidth={strokeWidth} />;
}

const SIZES = {
  sm: { tile: "h-9 w-9 rounded-[var(--radius-sm)]", icon: "h-[18px] w-[18px]" },
  md: { tile: "h-11 w-11 rounded-[var(--radius-md)]", icon: "h-5 w-5" },
  lg: { tile: "h-12 w-12 rounded-[var(--radius-md)]", icon: "h-6 w-6" },
} as const;

/** Kleine getönte Fläche mit dem Typ-Icon; rein dekorativ (der Typ steht immer auch als Text daneben). */
export function RecipeTypeTile({
  type,
  size = "md",
  className = "",
}: {
  type: RecipeTypeKey;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-recipe-type={type}
      className={`flex shrink-0 items-center justify-center text-ink/80 ${SIZES[size].tile} ${className}`}
      style={{ background: RECIPE_TYPE_TONES[type] }}
    >
      <RecipeTypeIcon type={type} className={SIZES[size].icon} />
    </span>
  );
}
