import { beforeEach, describe, expect, it, vi } from "vitest";

const profileFindUnique = vi.fn();
const householdMemberFindUnique = vi.fn();
const pantryItemFindMany = vi.fn();
const mealPlanDayFindMany = vi.fn();
const recipeFindMany = vi.fn();
const dismissedInsightFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    profile: { findUnique: (...args: unknown[]) => profileFindUnique(...args) },
    householdMember: { findUnique: (...args: unknown[]) => householdMemberFindUnique(...args) },
    pantryItem: { findMany: (...args: unknown[]) => pantryItemFindMany(...args) },
    mealPlanDay: { findMany: (...args: unknown[]) => mealPlanDayFindMany(...args) },
    recipe: { findMany: (...args: unknown[]) => recipeFindMany(...args) },
    dismissedInsight: { findMany: (...args: unknown[]) => dismissedInsightFindMany(...args) },
  },
}));

const getBudgetSummary = vi.fn();
vi.mock("../budget/budgetService", () => ({
  getBudgetSummary: (...args: unknown[]) => getBudgetSummary(...args),
}));

const { getInsightsForProfile } = await import("./insightService");

const now = new Date("2026-09-18T12:00:00Z");

const baseProfile = { id: "profile-1", userId: "user-1", dietType: "OMNIVORE", allergies: [] };

function expiringPantryItem() {
  return [{ id: "pantry-1", name: "Paprika", remainingQuantity: 2, unit: "PIECE", expirationDate: now }];
}

beforeEach(() => {
  vi.clearAllMocks();
  profileFindUnique.mockResolvedValue(baseProfile);
  householdMemberFindUnique.mockResolvedValue({ householdId: "household-1" });
  pantryItemFindMany.mockResolvedValue([]);
  getBudgetSummary.mockResolvedValue([]);
  mealPlanDayFindMany.mockResolvedValue([]);
  recipeFindMany.mockResolvedValue([]);
  dismissedInsightFindMany.mockResolvedValue([]);
});

describe("getInsightsForProfile", () => {
  it("liefert eine leere Liste, wenn das Profil keinem Haushalt angehört (keine erfundenen Insights ohne Datengrundlage)", async () => {
    profileFindUnique.mockResolvedValue(baseProfile);
    householdMemberFindUnique.mockResolvedValue(null);
    pantryItemFindMany.mockResolvedValue(expiringPantryItem());

    const insights = await getInsightsForProfile("profile-1", now);
    expect(insights).toHaveLength(0);
    expect(pantryItemFindMany).not.toHaveBeenCalled();
  });

  it("liefert ein Pantry-Insight, wenn ein Item heute abläuft", async () => {
    pantryItemFindMany.mockResolvedValue(expiringPantryItem());

    const insights = await getInsightsForProfile("profile-1", now);
    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe("PANTRY_EXPIRING_SOON");
  });

  it("unterdrückt ein bereits abgewiesenes Insight, obwohl die zugrunde liegende Bedingung weiter zutrifft", async () => {
    pantryItemFindMany.mockResolvedValue(expiringPantryItem());
    const first = await getInsightsForProfile("profile-1", now);
    dismissedInsightFindMany.mockResolvedValue([{ insightKey: first[0].id }]);

    const second = await getInsightsForProfile("profile-1", now);
    expect(second).toHaveLength(0);
  });

  it("liefert keine Insights, wenn es genuinely nichts zu sagen gibt (leerer Vorrat, kein Budget, kein Plan)", async () => {
    const insights = await getInsightsForProfile("profile-1", now);
    expect(insights).toHaveLength(0);
  });

  it("gibt eine leere Liste zurück, wenn kein Profil existiert", async () => {
    profileFindUnique.mockResolvedValue(null);
    const insights = await getInsightsForProfile("missing-profile", now);
    expect(insights).toHaveLength(0);
  });
});
