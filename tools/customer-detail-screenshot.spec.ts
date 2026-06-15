import { expect, test } from "@playwright/test";

test("opens customer detail from the all-customer list", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "전체 보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: /고객 관리.*전체 보기/ })).toBeVisible();

  await page.getByRole("cell", { name: /김민준 CU-2605-0020/ }).click();

  const drawer = page.getByRole("dialog", { name: "김민준 고객 상세 패널" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: /고객 관리.*김민준.*CU-2605-0020.*2026\/06\/09 12:56:39 접수/ })).toBeVisible();
  await expect(drawer.getByText("방금 전 고객 메모 업데이트")).toBeVisible();
  await expect(drawer.getByText("010-9588-0812")).toBeVisible();
  await expect(drawer.getByText("개인 · 4대보험")).toBeVisible();
  await expect(drawer.getByRole("button", { name: /담당자.*미배정/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /배정시간.*미배정/ })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Maybach S-Class" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Maybach S-Class.*S 500 4M Long/ })).toBeVisible();
  await expect(drawer.getByText("외장 컬러 미정 · 내장 컬러 미정")).toBeVisible();
  await expect(drawer.locator(".kim-needs-method-badge", { hasText: "운용리스" })).toBeVisible();
  await expect(drawer.getByText("문의사항")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "앱 상담 큐 보기", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "첨부 견적서 1 보기" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "첨부 견적서 2 보기" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "상세 구매조건" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "상세 구매조건 수정" })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: /구매방식.*운용리스/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /출고 희망 시기.*좋은 조건 즉시/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /계약 포커스.*#월 납입 최소.*#총 비용 최소.*#빠른 출고/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /계약기간.*60개월/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /초기비용.*보증금 30%/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /고객 특이사항.*#카톡 선호.*#가족과 상의/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /심사 특이사항.*#4대보험 확인.*#재직 확인 전/ })).toBeVisible();
  await expect(drawer.locator(".kim-purchase-condition-item > span")).toHaveText([
    "구매방식",
    "계약기간",
    "초기비용",
    "연간 주행거리",
    "인도 방식",
    "출고 희망 시기",
    "계약 포커스",
    "고객 특이사항",
    "심사 특이사항",
  ]);
  await drawer.getByRole("button", { name: /구매방식.*운용리스/ }).click();
  await expect(drawer.getByRole("dialog", { name: "구매방식 수정" })).toBeVisible();
  await expect(drawer.getByRole("dialog", { name: "구매방식 수정" }).getByRole("button", { name: "중고리스" })).toBeVisible();
  await expect(drawer.getByRole("dialog", { name: "구매방식 수정" }).getByRole("button", { name: "일시불" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer.getByRole("dialog", { name: "구매방식 수정" })).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "고객 메모" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "고객 메모 추가" })).toBeVisible();
  await expect(drawer.getByText("기존 고객 재구매 혜택 적용 가능성 확인 필요")).toBeVisible();
  const timelineButton = drawer.getByRole("button", { name: /상담 타임라인 열기.*4개 이력/ });
  await timelineButton.click();
  const timelineDialog = drawer.getByRole("dialog", { name: "상담 타임라인" });
  await expect(timelineDialog).toBeVisible();
  await expect(timelineDialog.getByText("상담 메모 업데이트")).toBeVisible();
  await expect(timelineDialog.getByRole("button", { name: "상담 타임라인 추가" })).toHaveCount(0);
  await expect(timelineDialog.getByRole("button", { name: "상담 타임라인 닫기" })).toHaveCount(0);
  await timelineButton.click();
  await expect(timelineDialog).toHaveCount(0);
  await expect(drawer.getByRole("heading", { name: "예정 일정" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "견적함" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "견적 작성" })).toBeVisible();
  const quoteActionButton = drawer.getByRole("button", { name: /견적 작업 열기/ }).first();
  await expect(quoteActionButton).toBeVisible();
  await quoteActionButton.click();
  await expect(page.getByRole("dialog", { name: "견적 작업" })).toBeVisible();
  await expect(page.getByText(/원본/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "견적 수정" })).toBeVisible();
  await page.getByRole("button", { name: "견적 수정" }).click();
  const quoteEditDialog = page.getByRole("dialog", { name: "견적 수정" });
  await expect(quoteEditDialog).toBeVisible();
  await expect(quoteEditDialog.getByRole("textbox", { name: "견적 제목" })).toHaveValue("Maybach S 500 운용리스 1차 견적");
  await quoteEditDialog.getByRole("textbox", { name: "월 납입금" }).fill("1,234,000원");
  await quoteEditDialog.getByRole("button", { name: "수정 후 발송" }).click();
  const revisedStatusButton = drawer.getByRole("button", { name: "수정 발송" }).first();
  await expect(revisedStatusButton).toBeVisible();
  await revisedStatusButton.hover();
  await expect(page.getByText(/수정 v2.*재발송/)).toBeVisible();
  await drawer.getByRole("button", { name: "견적 작성" }).click();
  const quoteWorkbenchDialog = page.getByRole("dialog", { name: "솔루션 견적 워크벤치" });
  await expect(quoteWorkbenchDialog).toBeVisible();
  await expect(quoteWorkbenchDialog.getByText("견적 작성 1")).toBeVisible();
  await expect(quoteWorkbenchDialog.getByText("견적 작성 2")).toBeVisible();
  await expect(quoteWorkbenchDialog.getByText("견적 작성 3")).toBeVisible();
  await expect(quoteWorkbenchDialog.locator('input[value="2,398,000"]').first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(quoteWorkbenchDialog).toHaveCount(0);
  await expect(drawer.getByRole("heading", { name: "서류함" })).toBeVisible();
  await expect(drawer.getByLabel("서류 파일 첨부")).toBeVisible();
  await expect(drawer.getByText("서류함").locator("..").getByText("2개")).toBeVisible();
  await expect(drawer.getByLabel("등본_함승우.pdf 문서 종류 변경")).toHaveValue("주민등록등본");
  await expect(drawer.getByLabel("사업자등록증_크리에이티브지안.png 문서 종류 변경")).toHaveValue("사업자등록증");
  await expect(drawer.getByRole("heading", { name: "해야 할 일" })).toBeVisible();
  await expect(drawer.getByText("GLC 재고 가능 여부 확인")).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "예정 일정" })).toBeVisible();

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

  await drawer.getByRole("button", { name: /상담경로.*디엘\(견적서\)/ }).click();
  await expect(drawer.getByRole("dialog", { name: "상담경로 수정" })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: /상담경로.*디엘\(견적서\)/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "앱 상담 큐 보기", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "첨부 견적서 1 보기" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "첨부 견적서 2 보기" })).toBeVisible();

  await drawer.getByRole("button", { name: /구매방식.*운용리스/ }).click();
  const methodEditor = drawer.getByRole("dialog", { name: "구매방식 수정" });
  await expect(methodEditor.getByRole("button", { name: "운용리스" })).toHaveAttribute("aria-pressed", "true");
  await methodEditor.getByRole("button", { name: "장기렌트" }).click();
  await expect(methodEditor.getByRole("button", { name: "장기렌트" })).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByRole("button", { name: /구매방식.*장기렌트.*운용리스/ })).toBeVisible();

  await drawer.getByRole("button", { name: /출고 희망 시기.*좋은 조건 즉시/ }).click();
  const timingEditor = drawer.getByRole("dialog", { name: "출고 희망 시기 수정" });
  await expect(timingEditor.getByRole("button", { name: "좋은 조건 즉시" })).toHaveAttribute("aria-pressed", "true");
  await timingEditor.getByRole("button", { name: "특정 월" }).click();
  await timingEditor.getByRole("button", { name: "8월" }).click();
  await expect(drawer.getByRole("button", { name: /출고 희망 시기.*8월 출고 희망/ })).toBeVisible();
  await drawer.getByRole("button", { name: /출고 희망 시기.*8월 출고 희망/ }).click();
  const timingClearEditor = drawer.getByRole("dialog", { name: "출고 희망 시기 수정" });
  await timingClearEditor.getByRole("button", { name: "특정 월" }).click();
  await timingClearEditor.getByRole("button", { name: "8월" }).click();
  await expect(drawer.getByRole("button", { name: /출고 희망 시기.*확인 필요/ })).toBeVisible();

  await drawer.getByRole("button", { name: /계약 포커스.*#월 납입 최소/ }).click();
  const costFocusEditor = drawer.getByRole("dialog", { name: "계약 포커스 수정" });
  await expect(costFocusEditor.getByRole("button", { name: "#월 납입 최소" })).toHaveAttribute("aria-pressed", "true");
  await costFocusEditor.getByRole("button", { name: "#할인 민감" }).click();
  await expect(costFocusEditor.getByRole("button", { name: "#할인 민감" })).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByRole("button", { name: /계약 포커스.*#월 납입 최소.*#총 비용 최소.*#빠른 출고.*#할인 민감/ })).toBeVisible();
  await costFocusEditor.getByRole("button", { name: "#승인 여부" }).click();
  await expect(page.getByText("최대 4개까지만 선택 가능합니다.")).toBeVisible();
  await expect(costFocusEditor.getByRole("button", { name: "#승인 여부" })).toHaveAttribute("aria-pressed", "false");

  await drawer.getByRole("button", { name: /계약기간.*60개월/ }).click();
  const termEditor = drawer.getByRole("dialog", { name: "계약기간 수정" });
  await expect(termEditor.getByRole("button", { name: "60개월" })).toHaveAttribute("aria-pressed", "true");
  await termEditor.getByRole("button", { name: "48개월" }).click();
  await expect(termEditor.getByRole("button", { name: "48개월" })).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByRole("button", { name: /계약기간.*48개월.*60개월/ })).toBeVisible();

  await drawer.getByRole("button", { name: /초기비용.*보증금 30%/ }).click();
  const initialCostEditor = drawer.getByRole("dialog", { name: "초기비용 수정" });
  await expect(initialCostEditor).toBeInViewport();
  await expect(initialCostEditor.getByRole("button", { name: "보증금" })).toHaveAttribute("aria-pressed", "true");
  await expect(initialCostEditor.getByRole("button", { name: "%" })).toHaveAttribute("aria-pressed", "true");
  await initialCostEditor.getByRole("button", { name: "선수금" }).click();
  await initialCostEditor.getByRole("button", { name: "금액" }).click();
  await initialCostEditor.getByRole("textbox", { name: "금액" }).fill("2000");
  await expect(initialCostEditor.getByRole("textbox", { name: "금액" })).toHaveValue("2,000");
  await initialCostEditor.getByRole("button", { name: "적용" }).click();
  await expect(drawer.getByRole("button", { name: /초기비용.*선수금 2,000만원/ })).toBeVisible();
  await drawer.getByRole("button", { name: /초기비용.*선수금 2,000만원/ }).click();
  const initialCostClearEditor = drawer.getByRole("dialog", { name: "초기비용 수정" });
  await initialCostClearEditor.getByRole("button", { name: "선수금" }).click();
  await initialCostClearEditor.getByRole("button", { name: "적용" }).click();
  await expect(drawer.getByRole("button", { name: /초기비용.*확인 필요/ })).toBeVisible();

  await drawer.getByRole("button", { name: /연간 주행거리.*확인 필요/ }).click();
  const mileageEditor = drawer.getByRole("dialog", { name: "연간 주행거리 수정" });
  await mileageEditor.getByRole("button", { name: "20,000km" }).click();
  await expect(drawer.getByRole("button", { name: /연간 주행거리.*20,000km/ })).toBeVisible();

  await drawer.getByRole("button", { name: /인도 방식.*협의 필요/ }).click();
  const deliveryEditor = drawer.getByRole("dialog", { name: "인도 방식 수정" });
  await deliveryEditor.getByRole("button", { name: "탁송 요청" }).click();
  await expect(drawer.getByRole("button", { name: /인도 방식.*탁송 요청/ })).toBeVisible();

  await drawer.getByRole("button", { name: /고객 특이사항.*#카톡 선호/ }).click();
  const customerNotesEditor = drawer.getByRole("dialog", { name: "고객 특이사항 수정" });
  await expect(customerNotesEditor.getByRole("button", { name: "#카톡 선호" })).toHaveAttribute("aria-pressed", "true");
  await customerNotesEditor.getByRole("button", { name: "#진행 잘 따라옴" }).click();
  await expect(customerNotesEditor.getByRole("button", { name: "#진행 잘 따라옴" })).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByRole("button", { name: /고객 특이사항.*#카톡 선호.*#가족과 상의.*#진행 잘 따라옴/ })).toBeVisible();

  await drawer.getByRole("button", { name: /심사 특이사항.*#4대보험 확인/ }).click();
  const reviewNotesEditor = drawer.getByRole("dialog", { name: "심사 특이사항 수정" });
  await expect(reviewNotesEditor.getByRole("button", { name: "#4대보험 확인" })).toHaveAttribute("aria-pressed", "true");
  await reviewNotesEditor.getByRole("button", { name: "#승인 우선" }).click();
  await expect(reviewNotesEditor.getByRole("button", { name: "#승인 우선" })).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByRole("button", { name: /심사 특이사항.*#4대보험 확인.*#재직 확인 전.*#승인 우선/ })).toBeVisible();

  await drawer.getByRole("button", { name: /담당자.*미배정/ }).click();
  const advisorEditor = drawer.getByRole("dialog", { name: "담당자 수정" });
  await advisorEditor.getByLabel("팀 선택").selectOption("인천본사");
  await advisorEditor.getByLabel("담당자 선택").selectOption("김지안");
  await advisorEditor.getByRole("button", { name: "배정" }).click();
  await expect(drawer.getByRole("button", { name: /담당자.*김지안.*인천본사/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /배정시간.*오늘 \d{2}:\d{2}/ })).toBeVisible();

  await page.waitForTimeout(2200);
  await page.screenshot({ fullPage: false, path: "screenshots/customer-detail-drawer-kimminjun-1440.png" });

  await drawer.getByRole("button", { name: /계약 가능성.*높음/ }).click();
  await drawer.getByRole("button", { name: "중간" }).click();
  await expect(drawer.getByRole("button", { name: /계약 가능성.*중간/ })).toBeVisible();

  await drawer.getByRole("button", { name: /관리 상태.*정상/ }).click();
  await expect(drawer.getByRole("dialog", { name: "관리 상태 수정" })).toHaveCount(0);
  await expect(page.getByText("관리 상태는 상담 메모와 최근 업데이트 기준으로 자동 반영됩니다.")).toBeVisible();
  await expect(drawer.getByRole("button", { name: /관리 상태.*정상/ })).toBeVisible();

  await drawer.getByRole("button", { name: /진행 상태.*견적.*발송완료/ }).click();
  await drawer.getByRole("button", { name: "차량체크" }).click();
  await drawer.getByRole("button", { name: "재고확인중", exact: true }).click();
  await expect(drawer.getByRole("button", { name: /진행 상태.*차량체크.*재고확인중/ })).toBeVisible();

  await page.getByRole("button", { name: "고객 상세 닫기" }).click({ position: { x: 30, y: 300 } });
  await expect(drawer).not.toBeVisible();

  const kimRow = page.getByRole("row", { name: /김민준 CU-2605-0020/ });
  await expect(kimRow).toContainText("재고확인중");
  await expect(kimRow.getByRole("button", { name: "가능성 변경: 중간" })).toBeVisible();
  await expect(kimRow.getByRole("button", { name: "최종 업데이트: 정상" })).toBeVisible();

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
