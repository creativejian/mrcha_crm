import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogTrim, TrimColor } from "@/lib/catalog";
import { discountText, fmtDate } from "./trim-format";

export function ColorChips({ colors }: { colors: TrimColor[] }) {
  if (!colors || colors.length === 0) return <div className="va-color-none">색상 없음</div>;
  const ext = colors.filter((c) => c.colorType === "exterior");
  const int = colors.filter((c) => c.colorType === "interior");
  const chip = (c: TrimColor, k: string) => (
    <span key={k} className="va-color-chip" style={{ backgroundColor: c.hexValue ?? "#cccccc" }} title={c.name} />
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
export function TrimHeadCells() {
  return (
    <>
      <th className="va-th-code">고유번호</th>
      <th className="va-col-center va-th-year">연식</th>
      <th className="va-th-price">기본가격(개소세인하)</th>
      <th className="va-col-center">가격변경일</th>
      <th>자사할인</th>
      <th>제휴할인</th>
      <th>타사할인</th>
      <th className="va-col-center">할인변경일</th>
      <th className="va-col-center va-th-status">상태</th>
    </>
  );
}

// 트림명 다음 ~ 편집 전 공통 셀(평면/그룹 테이블 컬럼 동기화).
export function TrimMetaCells({ trim }: { trim: CatalogTrim }) {
  return (
    <>
      <td className="va-num">{trim.mcCode ?? "—"}</td>
      <td className="va-col-center va-num">{trim.modelYear ?? "—"}</td>
      <td className="va-num">{trim.price.toLocaleString()}원</td>
      <td className="va-col-center va-num va-muted">{fmtDate(trim.priceUpdatedAt)}</td>
      <td className="va-num">{discountText(trim.financialDiscountAmount, trim.price)}</td>
      <td className="va-num">{discountText(trim.partnerDiscountAmount, trim.price)}</td>
      <td className="va-num">{discountText(trim.cashDiscountAmount, trim.price)}</td>
      <td className="va-col-center va-num va-muted">{fmtDate(trim.discountUpdatedAt)}</td>
      <td className="va-col-center">
        <span className={`badge ${statusBadgeTone(trim.status)}`}>{statusLabel(trim.status)}</span>
      </td>
    </>
  );
}
