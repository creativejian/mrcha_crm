import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { OptionPickerDialog } from "./OptionPickerDialog";
import type { TrimOption, TrimOptionRelation } from "./catalog-types";

const BASIC: TrimOption[] = [{ id: 1, name: "컨비니언스 패키지", price: 800000 }];
const TUNING: TrimOption[] = [
  { id: 2, name: "선루프", price: 1500000 },
  { id: 3, name: "고급 시트", price: 2000000 },
  { id: 4, name: "스포츠 서스펜션", price: 500000 },
];

// 행 버튼 안의 체크박스(라벨 미결합 — 행 텍스트로 조준).
function checkboxOf(name: string) {
  const row = screen.getByText(name).closest("button");
  if (!row) throw new Error(`옵션 행 없음: ${name}`);
  return within(row).getByRole("checkbox");
}

function baseProps() {
  return {
    open: true,
    onClose: () => {},
    basic: BASIC,
    tuning: TUNING,
    relations: [] as TrimOptionRelation[],
    onApply: () => {},
    trimDisplayName: "현대 팰리세이드",
  };
}

describe("OptionPickerDialog", () => {
  it("열려 있는 동안 selectedIds prop identity가 바뀌어도 로컬 선택 유지(부모 재렌더 리셋 방지)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OptionPickerDialog {...baseProps()} selectedIds={new Set()} />);
    await user.click(screen.getByText("선루프"));
    expect(checkboxOf("선루프")).toBeChecked();
    // 부모 재렌더 미러 — 내용은 같고 identity만 새 Set(워크벤치 input 버블 재렌더와 동일 조건).
    rerender(<OptionPickerDialog {...baseProps()} selectedIds={new Set()} />);
    expect(checkboxOf("선루프")).toBeChecked();
  });

  it("enforceIncludes=true: 켤 때 includes 상대 자동 ON(단방향·한 단계), 끌 때 연쇄 해제 없음", async () => {
    const user = userEvent.setup();
    const relations: TrimOptionRelation[] = [
      { optionId: 2, relatedOptionId: 3, type: "includes" },
      { optionId: 3, relatedOptionId: 4, type: "excludes" },
    ];
    render(<OptionPickerDialog {...baseProps()} relations={relations} selectedIds={new Set()} enforceIncludes />);
    await user.click(screen.getByText("선루프"));
    expect(checkboxOf("선루프")).toBeChecked();
    // includes 자동 ON + 자동 ON된 옵션(고급 시트)의 excludes 상대도 비활성(파생 disabledIds 공통 경로).
    expect(checkboxOf("고급 시트")).toBeChecked();
    expect(screen.getByText("스포츠 서스펜션").closest("button")).toBeDisabled();
    // 끌 때는 연쇄 해제 안 함(구 계약 미러 — resolveSelection off = 단순 삭제).
    await user.click(screen.getByText("선루프"));
    expect(checkboxOf("선루프")).not.toBeChecked();
    expect(checkboxOf("고급 시트")).toBeChecked();
  });

  it("기본(enforceIncludes 미지정): 켜도 includes 캡션만 표시, 자동 ON 없음(계산기 제프 원형)", async () => {
    const user = userEvent.setup();
    const relations: TrimOptionRelation[] = [{ optionId: 2, relatedOptionId: 3, type: "includes" }];
    render(<OptionPickerDialog {...baseProps()} relations={relations} selectedIds={new Set()} />);
    await user.click(screen.getByText("선루프"));
    expect(checkboxOf("선루프")).toBeChecked();
    expect(checkboxOf("고급 시트")).not.toBeChecked();
    expect(screen.getByText(/고급 시트 포함/)).toBeInTheDocument();
  });
});
