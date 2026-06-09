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
  await expect(drawer.getByRole("heading", { name: "확인할 일" })).toBeVisible();
  await expect(drawer.getByText("GLC 재고 가능 여부 확인")).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "다음 일정" })).toBeVisible();

  await drawer.getByRole("button", { name: /연락처.*010-9588-0812/ }).click();
  const phoneInput = drawer.getByRole("textbox", { name: "연락처 수정" });
  await expect(phoneInput).toHaveValue("010-9588-0812");
  await expect(phoneInput).toHaveJSProperty("selectionStart", 0);
  await expect(phoneInput).toHaveClass(/is-preview-value/);
  await phoneInput.pressSequentially("01012345678");
  await expect(phoneInput).toHaveValue("010-1234-5678");
  await expect(phoneInput).not.toHaveClass(/is-preview-value/);
  await drawer.getByRole("button", { name: "저장" }).click();
  await expect(drawer.getByRole("button", { name: /연락처.*010-1234-5678/ })).toBeVisible();

  await drawer.getByRole("button", { name: /직군.*개인.*4대보험/ }).click();
  await drawer.getByLabel("직군 분류").selectOption("개인");
  await drawer.getByLabel("상세 분류").selectOption("프리랜서");
  await drawer.getByRole("button", { name: "저장" }).click();
  await expect(drawer.getByRole("button", { name: /직군.*개인.*프리랜서/ })).toBeVisible();

  await drawer.getByRole("button", { name: /거주지.*인천광역시/ }).click();
  const locationEditor = drawer.getByRole("dialog", { name: "거주지 수정" });
  await locationEditor.getByLabel("거주지 수정").selectOption("인천광역시");
  await locationEditor.getByLabel("구/시 선택").selectOption("연수구");
  await locationEditor.getByRole("button", { name: "저장" }).click();
  await expect(drawer.getByRole("button", { name: /거주지.*인천광역시.*연수구/ })).toBeVisible();

  await drawer.getByRole("button", { name: /상담경로.*앱 견적비교/ }).click();
  await expect(drawer.getByRole("dialog", { name: "상담경로 수정" })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: /상담경로.*앱 견적비교/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "앱 상담 큐 보기", exact: true })).toBeVisible();

  await page.waitForTimeout(2200);
  await page.screenshot({ fullPage: false, path: "screenshots/customer-detail-drawer-kimminjun-1440.png" });

  await drawer.getByRole("button", { name: /계약 가능성.*높음/ }).click();
  await drawer.getByRole("button", { name: "중간" }).click();
  await expect(drawer.getByRole("button", { name: /계약 가능성.*중간/ })).toBeVisible();

  await drawer.getByRole("button", { name: /관리 상태.*정상/ }).click();
  await drawer.getByRole("button", { name: "지연" }).click();
  await expect(drawer.getByRole("button", { name: /관리 상태.*지연/ })).toBeVisible();

  await drawer.getByRole("button", { name: /진행 상태.*견적.*발송완료/ }).click();
  await drawer.getByRole("button", { name: "차량체크" }).click();
  await drawer.getByRole("button", { name: "재고확인중", exact: true }).click();
  await expect(drawer.getByRole("button", { name: /진행 상태.*차량체크.*재고확인중/ })).toBeVisible();

  await page.getByRole("button", { name: "고객 상세 닫기" }).click({ position: { x: 30, y: 300 } });
  await expect(drawer).not.toBeVisible();

  const kimRow = page.getByRole("row", { name: /김민준 CU-2605-0020/ });
  await expect(kimRow).toContainText("재고확인중");
  await expect(kimRow.getByRole("button", { name: "가능성 변경: 중간" })).toBeVisible();
  await expect(kimRow.getByRole("button", { name: "최종 업데이트: 지연" })).toBeVisible();

  await page.getByRole("cell", { name: /김민준 CU-2605-0020/ }).click();
  await expect(drawer).toBeVisible();

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
