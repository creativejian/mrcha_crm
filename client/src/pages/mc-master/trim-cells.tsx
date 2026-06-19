import { ListChecks } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogTrim, TrimColor, TrimOptionSummary } from "@/lib/catalog";
import { optionBadgeState } from "./option-badge";
import { discountText, fmtDate } from "./trim-format";

export function ColorChips({ colors }: { colors: TrimColor[] }) {
  if (!colors || colors.length === 0) return <div className="va-color-none">색상 없음</div>;
  const ext = colors.filter((c) => c.colorType === "exterior");
  const int = colors.filter((c) => c.colorType === "interior");
  const chip = (c: TrimColor, k: string) => (
    <span
      key={k}
      className="va-color-chip"
      style={{ backgroundColor: c.hexValue ?? "#cccccc" }}
      data-name={c.name}
      aria-label={c.name}
    />
  );
  return (
    <div className="va-color-chips">
      {ext.slice(0, 6).map((c, i) => chip(c, `e${i}`))}
      {ext.length > 6 && <span className="va-color-more">+{ext.length - 6}</span>}
      {int.length > 0 && <span className="va-color-div">|</span>}
      {int.slice(0, 6).map((c, i) => chip(c, `i${i}`))}
      {int.length > 6 && <span className="va-color-more">+{int.length - 6}</span>}
    </div>
  );
}

// 트림명 다음 ~ 편집 전 공통 헤더(평면/그룹 테이블 컬럼 동기화).
// 옵션 컬럼은 국산차만 표시(앱 패리티 — 수입차는 옵션 미관리).
export function TrimHeadCells({ showOption = true }: { showOption?: boolean }) {
  return (
    <>
      <th className="va-th-code">고유번호</th>
      <th className="va-col-center va-th-year">연식</th>
      <th className="va-th-price">기본가격(개소세인하)</th>
      <th className="va-col-center va-c-date">가격변경일</th>
      <th className="va-c-disc">자사할인</th>
      <th className="va-c-disc">제휴할인</th>
      <th className="va-c-disc">타사할인</th>
      <th className="va-col-center va-c-date">할인변경일</th>
      <th className="va-col-center va-th-status">상태</th>
      {showOption && <th className="va-col-center va-th-option">옵션</th>}
    </>
  );
}

// 트림 행 옵션 배지 버튼(클릭 → 옵션 패널). summary 없으면 '미정'. hover 시 옵션 상세 프리패치.
export function OptionBadgeButton({
  summary,
  onClick,
  onPrefetch,
}: {
  summary: TrimOptionSummary | undefined;
  onClick: () => void;
  onPrefetch?: () => void;
}) {
  const basic = summary?.basic ?? 0;
  const tuning = summary?.tuning ?? 0;
  const state = optionBadgeState(basic, tuning, summary?.noOption ?? false);
  const label =
    state === "has"
      ? `옵션 관리 (기본 ${basic} · 튜닝 ${tuning})`
      : state === "confirmed-none"
        ? "옵션 없음 확정"
        : "옵션 미입력";
  const text = state === "has" ? String(basic + tuning) : state === "confirmed-none" ? "✓" : "?";
  return (
    <button
      type="button"
      className="tiny-btn va-option-btn"
      onClick={onClick}
      onMouseEnter={() => onPrefetch?.()}
      onFocus={() => onPrefetch?.()}
      aria-label={label}
      title={label}
    >
      <ListChecks size={14} />
      <span className={`va-option-badge va-option-${state}`}>{text}</span>
    </button>
  );
}

// 트림명 다음 ~ 편집 전 공통 셀(평면/그룹 테이블 컬럼 동기화).
export function TrimMetaCells({ trim }: { trim: CatalogTrim }) {
  return (
    <>
      <td className="va-num">{trim.mcCode ?? "—"}</td>
      <td className="va-col-center va-num">{trim.modelYear ?? "—"}</td>
      <td className="va-num">{trim.price.toLocaleString()}원</td>
      <td className="va-col-center va-num va-muted va-c-date">{fmtDate(trim.priceUpdatedAt)}</td>
      <td className="va-num va-c-disc">{discountText(trim.financialDiscountAmount, trim.price)}</td>
      <td className="va-num va-c-disc">{discountText(trim.partnerDiscountAmount, trim.price)}</td>
      <td className="va-num va-c-disc">{discountText(trim.cashDiscountAmount, trim.price)}</td>
      <td className="va-col-center va-num va-muted va-c-date">{fmtDate(trim.discountUpdatedAt)}</td>
      <td className="va-col-center">
        <span className={`badge ${statusBadgeTone(trim.status)}`}>{statusLabel(trim.status)}</span>
      </td>
    </>
  );
}
