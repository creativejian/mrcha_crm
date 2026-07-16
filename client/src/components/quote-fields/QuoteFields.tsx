// 견적 조건 UI 공유 프리미티브 — 워크벤치(고객관리 견적)·계산기(비교견적)가 같은 파일을 import하는
// 표현 계층 SSOT(spec: ref/specs/2026-07-16-crm-quote-ui-ssot-design.md).
//
// 마크업은 현행 워크벤치 JSX 전사(클래스·구조·속성 순서 그대로) — 워크벤치 렌더 DOM 불변이 이
// 파일의 계약이다(빈 class=""는 다수 사용처와 일치하는 형태로 통일 — 시맨틱 무영향).
// 상태 아키텍처는 통합하지 않는다(spec D1): 워크벤치는 uncontrolled(data-* 추출 계약)·계산기는
// controlled 바인딩을 inputProps/selectProps 패스스루로 각자 전달한다 — React가 value/defaultValue
// 존재 여부로 controlled/uncontrolled를 판별하므로 한 컴포넌트로 양쪽이 성립한다.
import { ChevronDown, Trash2 } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { bindSelect } from "@/lib/select-bind";
import { discountLabelOptions, type DiscountUnit } from "@/components/customer-detail/quote-workbench-meta";

// data-* 속성(data-sc-field/data-pricing/data-discount-* 등 — 워크벤치 추출 계약)을 타입으로 허용.
export type MoneyInputProps = ComponentPropsWithoutRef<"input"> & Record<`data-${string}`, string | undefined>;
export type ValueSelectProps = ComponentPropsWithoutRef<"select"> & Record<`data-${string}`, string | undefined>;

export type SegmentOption<T extends string | number> = { value: T; label: string };

// 취득세 4모드 라벨 어휘 SSOT — 모드 value는 화면별 상태 계약(워크벤치 normal·계산기 none)이라
// 각자 zip한다(라벨만 1벌).
export const ACQUISITION_TAX_MODE_LABELS = ["일반", "하이브리드 감면", "전기차 감면", "직접 입력"] as const;

/** 세그먼트 버튼 그룹(.kim-jeff-segment). onSelect 미전달 = 장식 세그먼트(워크벤치 공채/탁송료/부대비용 현행). */
export function SegmentGroup<T extends string | number>({
  value,
  options,
  onSelect,
  disabled,
  wide,
}: {
  value: T;
  options: readonly SegmentOption<T>[];
  onSelect?: (next: T) => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`kim-jeff-segment${wide ? " wide" : ""}`}>
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? "active" : ""}
          disabled={disabled}
          onClick={onSelect ? () => onSelect(option.value) : undefined}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 금액 입력 셸(.kim-jeff-money-input + em 접미). 바인딩은 inputProps 소유자(화면) 몫. */
export function MoneyField({ fixed, suffix, inputProps }: { fixed?: boolean; suffix: string; inputProps: MoneyInputProps }) {
  return (
    <div className={`kim-jeff-money-input${fixed ? " is-fixed" : ""}`}>
      <input {...inputProps} />
      <em>{suffix}</em>
    </div>
  );
}

/** 비교 카드 행(label 80px | 1fr 그리드 — .kim-manual-compare-body 문법). */
export function CondRow({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={className}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** 카드 행 콤보(세그먼트 1/3 + 값 4/6 — .kim-manual-combo). */
export function CondCombo({ children }: { children: ReactNode }) {
  return <div className="kim-manual-combo">{children}</div>;
}

/** CM/AG 수수료 콤보(% 입력 1/3 + 원 미리보기 4/6 — .kim-manual-fee-combo). */
export function FeeCombo({ children }: { children: ReactNode }) {
  return <div className="kim-manual-fee-combo">{children}</div>;
}

/** 카드 값 select(.kim-manual-value-select). */
export function ValueSelect({ fixed, selectProps, children }: { fixed?: boolean; selectProps: ValueSelectProps; children: ReactNode }) {
  return (
    <select className={`kim-manual-value-select${fixed ? " is-fixed" : ""}`} {...selectProps}>
      {children}
    </select>
  );
}

/** 픽커 트리거 행(button.kim-jeff-picker-row — 다이얼로그 오픈 버튼). b 콘텐츠는 화면 몫(로고/스와치 허용). */
export function PickerTriggerRow({
  label,
  disabled,
  onClick,
  bClassName,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  bClassName?: string;
  children: ReactNode;
}) {
  return (
    <button className="kim-jeff-picker-row" type="button" disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      <b className={bClassName ?? ""}>{children}</b>
      <ChevronDown size={15} />
    </button>
  );
}

/** 상단 패널 행(.kim-jeff-form-row + 행 변형 클래스). */
export function FormRow({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`kim-jeff-form-row${className ? ` ${className}` : ""}`}>
      <span>{label}</span>
      {children}
    </div>
  );
}

/** 할인 행(기본/추가 — .kim-jeff-discount-row 5칸). 항목명 select·어휘(discountLabelOptions)는 프리미티브가 소유. */
export function DiscountLineRow({
  label,
  labelSelect,
  unit,
  onUnitChange,
  inputProps,
  action,
}: {
  label: string;
  /** 없으면 자리 placeholder(기본 할인 행) — 있으면 항목명 select(추가 할인 행, Safari 규칙 bindSelect). */
  labelSelect?: { value: string; onSelect: (next: string) => void };
  unit: DiscountUnit;
  onUnitChange: (next: DiscountUnit) => void;
  inputProps: MoneyInputProps;
  action: { kind: "add" | "remove"; onClick: () => void };
}) {
  return (
    <div className="kim-jeff-form-row kim-jeff-discount-row">
      <span>{label}</span>
      {labelSelect ? (
        <select className="kim-jeff-discount-label" aria-label="할인 항목명" {...bindSelect(labelSelect.value, labelSelect.onSelect)}>
          {discountLabelOptions.map((option) => <option key={option}>{option}</option>)}
        </select>
      ) : (
        <span className="kim-jeff-discount-label-placeholder" aria-hidden="true" />
      )}
      <SegmentGroup
        value={unit}
        options={[{ value: "amount", label: "금액" }, { value: "percent", label: "%" }]}
        onSelect={onUnitChange}
      />
      <MoneyField suffix={unit === "percent" ? "%" : "원"} inputProps={inputProps} />
      {action.kind === "add" ? (
        <button className="kim-jeff-discount-add" aria-label="할인 항목 추가" onClick={action.onClick} type="button">+</button>
      ) : (
        <button className="kim-jeff-discount-remove" aria-label="할인 항목 삭제" onClick={action.onClick} type="button"><Trash2 size={13} strokeWidth={2.1} /></button>
      )}
    </div>
  );
}

/** 가격 셀(.kim-jeff-price-cell — 기본 가격/옵션 금액/최종 할인). */
export function PriceCell({ label, inputProps, suffix = "원" }: { label: string; inputProps: MoneyInputProps; suffix?: string }) {
  return (
    <div className="kim-jeff-price-cell">
      <strong>{label}</strong>
      <MoneyField suffix={suffix} inputProps={inputProps} />
    </div>
  );
}

/** 최종 가격 표시 행(.kim-jeff-summary-row). value는 표시 문자열(포맷은 화면 몫). */
export function SummaryRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`kim-jeff-summary-row${className ? ` ${className}` : ""}`}>
      <span>{label}</span>
      <b><span>{value}</span><em>원</em></b>
    </div>
  );
}
