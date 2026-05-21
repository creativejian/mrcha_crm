import { expect, test } from "@playwright/test";

const screenshotsDir = "screenshots";

test("captures core CRM UI screens", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await page.screenshot({ fullPage: true, path: `${screenshotsDir}/dashboard-1440.png` });

  await page.getByRole("button", { name: "전체 보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: /고객 관리.*전체 보기/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /김민준 CU-2605-0020/ })).toBeVisible();
  await page.screenshot({ fullPage: true, path: `${screenshotsDir}/customer-management-1440.png` });

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("heading", { name: /고객 관리.*전체 보기/ })).toBeVisible();
  await page.screenshot({ fullPage: true, path: `${screenshotsDir}/customer-management-1280.png` });

  await page.locator(".table-scroll").evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await page.screenshot({ fullPage: true, path: `${screenshotsDir}/customer-management-1280-right.png` });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ fullPage: true, path: `${screenshotsDir}/customer-management-line-draft-1440.png` });
});
