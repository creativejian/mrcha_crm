import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { ListChecks } from "lucide-react";

import { statusBadgeTone, statusLabel } from "@/data/vehicle-taxonomy";
import type { CatalogTrim, TrimColor, TrimOptionSummary } from "@/lib/catalog";
import type { DealerDiscountAmounts, DealerDiscountProposal } from "@/lib/dealer-discounts";
import type { TrimProposals } from "@/lib/discount-proposals";
import { AdminDiscountCells, type AdoptHandler } from "./admin-discount-cells";
import { optionBadgeState } from "./option-badge";
import { applyThousandsInput } from "./thousands-input";
import { fmtDate, formatThousands, parseWon } from "./trim-format";

// ⚠️ 이 파일의 아래쪽 `DiscountField`는 **딜러 제안 금액 컬럼 키**(financialAmount…)다.
// 관리자 채택의 필드 어휘(financial…)는 이름이 같고 값이 달라 섞이면 위험하므로,
// 채택 팝오버는 admin-discount-cells.tsx에 따로 두고 여기서는 핸들러 타입만 받는다.

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
export function TrimHeadCells({
  showOption = true,
  showDiscountDate = true,
}: {
  showOption?: boolean;
  /** 딜러 모드에선 false — 확정 할인을 안 내리므로 할인변경일이 항상 빈 칸이 된다(빈 열은
   *  감춘 의도가 아니라 고장으로 읽힌다). 본문 td는 TrimMetaCells가 onSaveProposal로 판단한다. */
  showDiscountDate?: boolean;
}) {
  return (
    <>
      <th className="va-th-code">고유번호</th>
      <th className="va-col-center va-th-year">연식</th>
      <th className="va-th-price">기본가격(개소세인하)</th>
      <th className="va-col-center va-c-date">가격변경일</th>
      <th className="va-c-disc">자사할인</th>
      <th className="va-c-disc">제휴할인</th>
      <th className="va-c-disc">타사할인</th>
      {showDiscountDate && <th className="va-col-center va-c-date">할인변경일</th>}
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

// 딜러 모드 할인 3셀 — **내 제안만** 입력하고 본다.
// ⚠️ 확정값 보조표기는 2026-07-27 제거했다(유슨생 결정 — 구 spec §7.1의 "아래 회색으로 함께
// 보여준다"는 폐기): 관리자 확정 할인을 딜러가 보면 다른 딜러 제안이 채택된 결과를 역산할 수
// 있고, 관리자가 얼마로 확정했는지 알고 제안을 맞추게 된다.
// 저장은 **디바운스 자동 저장**이다(입력 후 800ms): 조직 화면에서 [저장] 버튼을 놓친 실기 사례가
// 있어 누를 게 없는 쪽을 택했다. 제안값이라 실수 저장 위험이 낮다(관리자 채택 전이고, 확정
// 할인은 이 경로로 절대 바뀌지 않는다).
const DEALER_SAVE_DEBOUNCE_MS = 800;
type SaveState = "idle" | "saving" | "saved" | "error";
type DiscountField = keyof DealerDiscountAmounts;
const DISCOUNT_FIELDS: DiscountField[] = ["financialAmount", "partnerAmount", "cashAmount"];

function DealerDiscountCells({
  trim,
  proposal,
  onSave,
}: {
  trim: CatalogTrim;
  proposal: DealerDiscountProposal | undefined;
  onSave: (trimId: number, amounts: DealerDiscountAmounts) => Promise<void>;
}) {
  // **편집 중 값만 draft로 들고, 없으면 서버 값을 그대로 렌더한다** — useState 초기값 + effect
  // 동기화 형태는 제안 목록이 늦게 도착하면 빈 값으로 굳고, 그걸 effect setState로 고치면
  // react-hooks/set-state-in-effect에 걸린다(#84·슬라이스 A와 같은 선례).
  const [draft, setDraft] = useState<Record<DiscountField, string> | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const timerRef = useRef<number | null>(null);

  // 언마운트 시 예약된 저장을 취소한다(setState는 하지 않는다 — cleanup에서 상태를 만지면 룰 위반).
  useEffect(
    () => () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    },
    [],
  );

  const serverText = useCallback(
    (field: DiscountField) => {
      const v = proposal?.[field] ?? null;
      return v == null ? "" : formatThousands(String(v));
    },
    [proposal],
  );

  const flush = useCallback(
    async (next: Record<DiscountField, string>) => {
      setState("saving");
      try {
        await onSave(trim.id, {
          financialAmount: parseWon(next.financialAmount),
          partnerAmount: parseWon(next.partnerAmount),
          cashAmount: parseWon(next.cashAmount),
        });
        setState("saved");
        setDraft(null); // 서버 값으로 복귀(부모 Map이 갱신돼 있다)
      } catch {
        // ⚠️ 실패를 삼키지 않는다 — 화면에 남겨야 딜러가 재시도할 수 있다(구 조직 화면의 결함).
        setState("error");
      }
    },
    [onSave, trim.id],
  );

  // applyThousandsInput이 포맷과 **커서 복원**을 맡는다 — 중간 숫자를 지울 때 커서가 끝으로 튀면
  // 딜러가 금액을 고칠 수 없다(2026-07-28 유슨생 실기 · thousands-input.ts 참조).
  const change = (field: DiscountField) => (e: SyntheticEvent<HTMLInputElement>) =>
    applyThousandsInput(e, (formatted) => {
      const base = draft ?? {
        financialAmount: serverText("financialAmount"),
        partnerAmount: serverText("partnerAmount"),
        cashAmount: serverText("cashAmount"),
      };
      const next = { ...base, [field]: formatted };
      setDraft(next);
      setState("idle");
      if (timerRef.current != null) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(next), DEALER_SAVE_DEBOUNCE_MS);
    });

  return (
    <>
      {/* 실제 차단은 서버가 한다 — `lib/dealer-visibility.ts`의 visibleTrimsFor가 딜러 요청에
          확정 3금액·할인변경일을 null로 내린다. 화면에서만 감추면 DevTools로 보인다. */}
      {DISCOUNT_FIELDS.map((field, i) => {
        const value = draft ? draft[field] : serverText(field);
        return (
          <td className="va-num va-c-disc va-dealer-disc" key={field}>
            <input inputMode="numeric" onChange={change(field)} placeholder="—" value={value} />
            {/* 상태는 마지막 셀에 한 번만 — 3셀에 각각 띄우면 노이즈다. */}
            {i === DISCOUNT_FIELDS.length - 1 && state !== "idle" && (
              <small className={state === "error" ? "va-dealer-disc-error" : undefined}>
                {state === "saving" ? "저장 중…" : state === "saved" ? "저장됨" : "저장 실패 — 다시 입력해 주세요"}
              </small>
            )}
          </td>
        );
      })}
    </>
  );
}

// 트림명 다음 ~ 편집 전 공통 셀(평면/그룹 테이블 컬럼 동기화).
// onSaveProposal이 있으면 **딜러 모드**다 — 할인 3셀이 내 제안 입력칸으로 바뀐다.
export function TrimMetaCells({
  trim,
  dealerProposal,
  onSaveProposal,
  proposalEntry,
  onAdopt,
}: {
  trim: CatalogTrim;
  dealerProposal?: DealerDiscountProposal;
  onSaveProposal?: (trimId: number, amounts: DealerDiscountAmounts) => Promise<void>;
  /** 관리자 모드 — 이 트림에 들어온 딜러 제안(없으면 셀에 단서가 붙지 않는다). */
  proposalEntry?: TrimProposals;
  onAdopt?: AdoptHandler;
}) {
  return (
    <>
      <td className="va-num">{trim.mcCode ?? "—"}</td>
      <td className="va-col-center va-num">{trim.modelYear ?? "—"}</td>
      <td className="va-num">{trim.price.toLocaleString()}원</td>
      <td className="va-col-center va-num va-muted va-c-date">{fmtDate(trim.priceUpdatedAt)}</td>
      {onSaveProposal ? (
        <DealerDiscountCells onSave={onSaveProposal} proposal={dealerProposal} trim={trim} />
      ) : (
        <AdminDiscountCells entry={proposalEntry} onAdopt={onAdopt} trim={trim} />
      )}
      {/* 딜러 모드에선 열째 없앤다 — 서버가 확정 할인을 안 내리므로 항상 빈 칸이 된다.
          헤더(TrimHeadCells)의 showDiscountDate와 **함께** 켜고 꺼야 열 수가 맞는다. */}
      {!onSaveProposal && (
        <td className="va-col-center va-num va-muted va-c-date">{fmtDate(trim.discountUpdatedAt)}</td>
      )}
      <td className="va-col-center">
        <span className={`badge ${statusBadgeTone(trim.status)}`}>{statusLabel(trim.status)}</span>
      </td>
    </>
  );
}
