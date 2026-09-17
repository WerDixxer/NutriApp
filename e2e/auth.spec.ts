import { expect, test } from "@playwright/test";

/**
 * Smoke-Tests für den Routenschutz. Bewusst ohne Registrierung/Login gegen
 * echte Daten: der Test läuft gegen die lokale Dev-Datenbank ohne eigene
 * Testdatenbank (offener Punkt, siehe Chapter-1-Bericht), ein hier
 * angelegter Account würde also liegen bleiben.
 */
test.describe("Routenschutz", () => {
  test("leitet nicht angemeldete Nutzer von einer geschützten Seite zu /login um", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  });

  test("zeigt das Login-Formular mit E-Mail- und Passwortfeld", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("textbox").first()).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  });

  test("zeigt das Registrierungsformular", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Konto erstellen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Konto erstellen" })).toBeVisible();
  });
});
