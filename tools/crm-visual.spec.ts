import { expect, test } from "@playwright/test";

test.describe("CRM visual baselines", () => {
  test("dashboard shell at 1440px", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
    await expect(page).toHaveScreenshot("dashboard-1440.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });
  });

  test("customer management list at 1440px", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "전체 보기" }).click();
    await expect(page.getByRole("heading", { name: "고객 관리 · 전체 보기" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /김민준/ })).toBeVisible();
    await expect(page).toHaveScreenshot("customer-management-1440.png", {
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });
  });
});
