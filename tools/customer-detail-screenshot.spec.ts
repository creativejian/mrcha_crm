import { expect, test } from "@playwright/test";

test("opens customer detail from the all-customer list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "전체 보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: /고객 관리.*전체 보기/ })).toBeVisible();

  await page.getByRole("cell", { name: /김민준 CU-2605-0020/ }).click();

  const drawer = page.getByRole("dialog", { name: "김민준 고객 상세 패널" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: /고객 관리.*김민준.*CU-2605-0020/ })).toBeVisible();
  await expect(drawer.getByText("방금 전 상담 메모 업데이트")).toBeVisible();
  await expect(drawer.getByText("010-9588-0812")).toBeVisible();
  await expect(drawer.getByText("개인 · 4대보험")).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Maybach S-Class" })).toBeVisible();
  await expect(drawer.getByText("S 500 4M Long")).toBeVisible();
  await expect(drawer.getByText("외장 컬러 미정 · 내장 컬러 미정")).toBeVisible();
  await expect(drawer.locator(".kim-needs-method-badge", { hasText: "운용리스" })).toBeVisible();
  await expect(drawer.getByText("문의사항")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "앱 상담 큐 보기", exact: true })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "상세 구매조건" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "상담 기록" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "상담 기록 추가" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "다음 일정" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "견적함" })).toBeVisible();
  await expect(drawer.getByText("첨부").first()).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "서류함" })).toBeVisible();
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

  await expect(drawer.getByRole("button", { name: "전체 화면" })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "닫기" })).toHaveCount(0);
});
