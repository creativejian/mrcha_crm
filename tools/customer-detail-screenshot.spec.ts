import { expect, test } from "@playwright/test";

test("opens customer detail from the all-customer list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "전체 보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: /고객 관리.*전체 보기/ })).toBeVisible();

  await page.getByRole("cell", { name: /김민준 CU-2605-0020/ }).click();

  const drawer = page.getByRole("dialog", { name: "김민준 고객 상세 패널" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "상담 타임라인" })).toBeVisible();
  await expect(drawer.getByText("Maybach S-Class")).toBeVisible();
  await page.waitForTimeout(2200);
  await page.screenshot({ fullPage: false, path: "screenshots/customer-detail-drawer-kimminjun-1440.png" });

  await page.getByRole("button", { name: "고객 상세 닫기" }).click({ position: { x: 30, y: 300 } });
  await expect(drawer).not.toBeVisible();

  await page.getByRole("cell", { name: /김민준 CU-2605-0020/ }).click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();

  await page.getByRole("cell", { name: /김민준 CU-2605-0020/ }).click();
  await expect(drawer).toBeVisible();

  await drawer.getByRole("button", { name: "전체 화면" }).click();
  await expect(page.getByRole("heading", { name: /고객 관리.*전체 보기.*김민준/ })).toBeVisible();
  await page.screenshot({ fullPage: true, path: "screenshots/customer-detail-fullscreen-kimminjun-1440.png" });
});
