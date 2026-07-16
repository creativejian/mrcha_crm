import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CondCombo,
  CondRow,
  DiscountLineRow,
  FeeCombo,
  FormRow,
  MoneyField,
  PickerTriggerRow,
  PriceCell,
  SegmentGroup,
  SummaryRow,
  ValueSelect,
} from "./QuoteFields";
import { ACQUISITION_TAX_MODE_LABELS } from "@/components/customer-detail/quote-workbench-meta";

describe("SegmentGroup", () => {
  it("active 분기·클릭 시 onSelect(value)·wide 변형", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = render(
      <SegmentGroup value="amount" options={[{ value: "amount", label: "금액" }, { value: "percent", label: "%" }]} onSelect={onSelect} wide />,
    );
    const group = container.firstElementChild as HTMLElement;
    expect(group.className).toBe("kim-jeff-segment wide");
    expect(screen.getByRole("button", { name: "금액" }).className).toBe("active");
    expect(screen.getByRole("button", { name: "%" }).className).toBe("");
    await user.click(screen.getByRole("button", { name: "%" }));
    expect(onSelect).toHaveBeenCalledWith("percent");
  });

  it("onSelect 미전달 = 장식 세그먼트(클릭 무동작 — 워크벤치 공채/탁송료/부대비용 현행)", async () => {
    const user = userEvent.setup();
    render(<SegmentGroup value="included" options={[{ value: "included", label: "포함" }, { value: "excluded", label: "불포함" }]} />);
    await user.click(screen.getByRole("button", { name: "불포함" }));
    expect(screen.getByRole("button", { name: "포함" }).className).toBe("active");
  });

  it("disabled가 전 버튼에 전파(카드 저장 상태)", () => {
    render(<SegmentGroup value={36} options={[{ value: 36, label: "36개월" }, { value: 48, label: "48개월" }]} disabled />);
    expect(screen.getByRole("button", { name: "36개월" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "48개월" })).toBeDisabled();
  });
});

describe("MoneyField", () => {
  it("data-* 추출 계약·defaultValue(uncontrolled)·is-fixed·suffix 패스스루", () => {
    const { container } = render(
      <MoneyField
        fixed
        suffix="%"
        inputProps={{ "aria-label": "CM수수료 퍼센트", "data-discount-unit": "percent", "data-sc-field": "cmFeePercent", defaultValue: "1.5", readOnly: true }}
      />,
    );
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toBe("kim-jeff-money-input is-fixed");
    const input = screen.getByLabelText("CM수수료 퍼센트");
    expect(input).toHaveAttribute("data-sc-field", "cmFeePercent");
    expect(input).toHaveAttribute("data-discount-unit", "percent");
    expect(input).toHaveValue("1.5");
    expect(input).toHaveAttribute("readonly");
    expect(shell.querySelector("em")?.textContent).toBe("%");
  });

  it("controlled(value/onChange) 바인딩도 성립(계산기 경로)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MoneyField suffix="원" inputProps={{ "aria-label": "기본 가격", value: "50,000,000", onChange }} />);
    const input = screen.getByLabelText("기본 가격");
    expect(input).toHaveValue("50,000,000");
    await user.type(input, "1");
    expect(onChange).toHaveBeenCalled();
  });
});

describe("CondRow / CondCombo / FeeCombo / FormRow", () => {
  it("CondRow = label>span+children, className 분기(select-value 등)", () => {
    const { container } = render(<CondRow label="기간" className="select-value"><i data-x="1" /></CondRow>);
    const row = container.firstElementChild as HTMLElement;
    expect(row.tagName).toBe("LABEL");
    expect(row.className).toBe("select-value");
    expect(row.querySelector("span")?.textContent).toBe("기간");
    expect(row.querySelector("i[data-x='1']")).not.toBeNull();
  });

  it("CondRow className 미전달 = class 속성 없음(워크벤치 다수 행 현행)", () => {
    const { container } = render(<CondRow label="보증금"><i /></CondRow>);
    expect((container.firstElementChild as HTMLElement).hasAttribute("class")).toBe(false);
  });

  it("콤보 래퍼 클래스", () => {
    const { container } = render(<><CondCombo><i /></CondCombo><FeeCombo><i /></FeeCombo></>);
    expect(container.querySelector(".kim-manual-combo")).not.toBeNull();
    expect(container.querySelector(".kim-manual-fee-combo")).not.toBeNull();
  });

  it("FormRow = div.kim-jeff-form-row(+변형 클래스)>span+children", () => {
    const { container } = render(<FormRow label="취득세" className="kim-jeff-acquisition-tax-row"><i /></FormRow>);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toBe("kim-jeff-form-row kim-jeff-acquisition-tax-row");
    expect(row.querySelector("span")?.textContent).toBe("취득세");
  });
});

describe("ValueSelect", () => {
  it("is-fixed·selectProps 패스스루·children 옵션", () => {
    const { container } = render(
      <ValueSelect fixed selectProps={{ "aria-label": "약정거리", disabled: true, defaultValue: "20,000km / 년" }}>
        <option>20,000km / 년</option>
      </ValueSelect>,
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.className).toBe("kim-manual-value-select is-fixed");
    expect(select).toBeDisabled();
    expect(select.value).toBe("20,000km / 년");
  });
});

describe("PickerTriggerRow", () => {
  it("button.kim-jeff-picker-row 문법 + b 클래스(muted)·클릭", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<PickerTriggerRow label="제조사" onClick={onClick} bClassName="muted">선택</PickerTriggerRow>);
    const button = screen.getByRole("button", { name: /제조사/ });
    expect(button.className).toBe("kim-jeff-picker-row");
    expect(button).toHaveAttribute("type", "button");
    const b = button.querySelector("b") as HTMLElement;
    expect(b.className).toBe("muted");
    expect(b.textContent).toBe("선택");
    await user.click(button);
    expect(onClick).toHaveBeenCalled();
  });

  it("bClassName 기본값 = 빈 class(워크벤치 현행)·disabled", () => {
    render(<PickerTriggerRow label="모델" disabled onClick={() => {}}>팰리세이드</PickerTriggerRow>);
    const button = screen.getByRole("button", { name: /모델/ });
    expect(button).toBeDisabled();
    expect(button.querySelector("b")?.getAttribute("class")).toBe("");
  });
});

describe("DiscountLineRow", () => {
  it("기본 할인 행 = placeholder span + add 버튼, suffix는 unit 파생", () => {
    const onUnitChange = vi.fn();
    const { container } = render(
      <DiscountLineRow
        label="기본 할인"
        unit="amount"
        onUnitChange={onUnitChange}
        inputProps={{ "data-discount-line": "true", "data-discount-primary": "true", "data-discount-unit": "amount", defaultValue: "0" }}
        action={{ kind: "add", onClick: () => {} }}
      />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toBe("kim-jeff-form-row kim-jeff-discount-row");
    expect(row.querySelector(".kim-jeff-discount-label-placeholder")).not.toBeNull();
    expect(row.querySelector("select")).toBeNull();
    expect(screen.getByRole("button", { name: "할인 항목 추가" }).className).toBe("kim-jeff-discount-add");
    expect(row.querySelector(".kim-jeff-money-input em")?.textContent).toBe("원");
    expect(row.querySelector("input")).toHaveAttribute("data-discount-primary", "true");
  });

  it("추가 할인 행 = 항목명 select(어휘 SSOT)·% suffix·remove 버튼, 선택 시 onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    render(
      <DiscountLineRow
        label="추가 할인"
        labelSelect={{ value: "재구매 할인", onSelect }}
        unit="percent"
        onUnitChange={() => {}}
        inputProps={{ "data-discount-id": "d1", "data-discount-line": "true", "data-discount-unit": "percent", defaultValue: "0" }}
        action={{ kind: "remove", onClick: onRemove }}
      />,
    );
    const select = screen.getByLabelText("할인 항목명") as HTMLSelectElement;
    expect(select.className).toBe("kim-jeff-discount-label");
    expect([...select.options].map((o) => o.text)).toEqual(["재구매 할인", "법인 추가 할인", "기타"]);
    await user.selectOptions(select, "기타");
    expect(onSelect).toHaveBeenCalledWith("기타");
    await user.click(screen.getByRole("button", { name: "할인 항목 삭제" }));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe("PriceCell / SummaryRow", () => {
  it("PriceCell = strong 라벨 + MoneyField", () => {
    const { container } = render(<PriceCell label="기본 가격" inputProps={{ "data-pricing": "base", defaultValue: "0" }} />);
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.className).toBe("kim-jeff-price-cell");
    expect(cell.querySelector("strong")?.textContent).toBe("기본 가격");
    expect(cell.querySelector("input")).toHaveAttribute("data-pricing", "base");
  });

  it("SummaryRow = span 라벨 + b>span+em, className 변형", () => {
    const { container } = render(<SummaryRow label="취득원가" value="52,000,000" className="emphasized" />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toBe("kim-jeff-summary-row emphasized");
    expect(row.querySelector("b > span")?.textContent).toBe("52,000,000");
    expect(row.querySelector("b > em")?.textContent).toBe("원");
  });
});

describe("어휘 상수", () => {
  it("취득세 4모드 라벨 1벌", () => {
    expect(ACQUISITION_TAX_MODE_LABELS).toEqual(["일반", "하이브리드 감면", "전기차 감면", "직접 입력"]);
  });
});
