import { useRef, useState, type ReactNode, type RefObject } from "react";

import type { CatalogTrim } from "@/lib/catalog";
import { DISCOUNT_FIELDS, DISCOUNT_FIELD_LABELS, type DiscountField } from "@/lib/discount-adoption";
import type { TrimProposals } from "@/lib/discount-proposals";
import { useFixedPopoverPosition } from "@/lib/use-fixed-popover-position";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";
import { usePopoverViewportClose } from "@/lib/use-popover-viewport-close";
import { discountText, fmtDate } from "./trim-format";

// 관리자 할인 3셀 — 확정값을 보여주고, 딜러 제안이 들어온 필드에만 개수 단서를 달아 팝오버로
// **필드 단위 채택**을 하게 한다. 제안이 0건이면 기존과 똑같은 정적 셀이다(관리자 직접 편집은
// TrimEditPanel 그대로 — 이 팝오버는 "딜러가 낸 값을 확정으로 올리는" 경로만 담당한다).
//
// ⚠️ 여기서 [채택]을 누르면 **앱 고객에게 보이는 확정 할인이 바뀐다**. 그래서 ①필드마다 따로
// 누르게 하고(자사는 동성모터스, 제휴는 코오롱 — 이사님 요구) ②현재 확정값과 그 출처를 팝오버
// 상단에 항상 보여준다(무엇을 덮는지 모르고 누르는 상황을 만들지 않는다).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §7.2
export type AdoptHandler = (trimId: number, field: DiscountField, dealerUserId: string) => Promise<void>;
export type UndoHandler = (trimId: number, field: DiscountField) => Promise<void>;

// 할인 필드 → CatalogTrim의 확정값 키. 서버 FIELD_MAP과 같은 축이지만 이쪽은 **응답 모델**의
// 키다(SQL 컬럼명은 클라의 관심사가 아니다 — 어휘만 discount-adoption.ts가 SSOT).
const TRIM_AMOUNT_KEYS = {
  financial: "financialDiscountAmount",
  partner: "partnerDiscountAmount",
  cash: "cashDiscountAmount",
} as const satisfies Record<DiscountField, keyof CatalogTrim>;

// "새 제안"은 무엇을 해야 하는지 알려주지 않아 실기에서 "이게 뭔지" 질문이 나왔다(2026-07-28) —
// 관리자가 취할 행동을 그대로 쓴다. hint는 title 속성으로 붙여 판단 근거까지 남긴다.
const STATE_BADGE: Record<string, { text: string; tone: string; hint: string }> = {
  adopted: { text: "채택됨", tone: "ok", hint: "이 딜러 값이 현재 확정 할인입니다." },
  changed: {
    text: "재채택 필요",
    tone: "warn",
    hint: "이 딜러 값이 채택된 뒤 제안 금액이 바뀌었습니다 — 다시 채택해야 확정에 반영됩니다.",
  },
};

// 할인 채택 팝오버 셸 — `.va-disc-cell`(td)을 앵커로 fixed 좌표를 인라인 주입한다. absolute였을
// 때는 표(`.table-scroll`, 양축 overflow) 하단 행에서 화면 밖에 그려져 [채택] 버튼이 클릭 자체가
// 안 됐다(2026-07-31 prod 실측: 마지막 트림에서 가시 0px). 팝오버를 별도 컴포넌트로 둔 이유는
// 훅이 **팝오버가 마운트된 시점에** 좌표를 재도록 하기 위해서다(부모에서 부르면 popRef가 아직
// 비어 pos가 null로 남는다 — 드로어의 ConfirmPopover와 같은 구조).
// heightDep: 실패 메시지가 붙으면 높이가 바뀌므로 방향·좌표를 다시 계산한다.
function DiscountPopover({ children, heightDep, popRef }: {
  children: ReactNode;
  heightDep?: unknown;
  popRef: RefObject<HTMLDivElement | null>;
}) {
  const pos = useFixedPopoverPosition(popRef, ".va-disc-cell", heightDep, "end");
  return (
    <div
      className="va-disc-pop"
      ref={popRef}
      role="dialog"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
    >
      {children}
    </div>
  );
}

export function AdminDiscountCells({
  trim,
  entry,
  onAdopt,
  onUndo,
}: {
  trim: CatalogTrim;
  entry?: TrimProposals;
  onAdopt?: AdoptHandler;
  onUndo?: UndoHandler;
}) {
  const [openField, setOpenField] = useState<DiscountField | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"adopt" | "undo" | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(popRef, openField !== null, () => setOpenField(null));
  // fixed는 스크롤·리사이즈를 따라가지 못한다 — 앵커에서 분리되기 전에 닫는다(드로어 확인
  // 팝오버·목록 stage/chance/delivery와 같은 한 벌).
  usePopoverViewportClose(openField !== null, () => setOpenField(null));

  async function adopt(field: DiscountField, dealerUserId: string) {
    if (!onAdopt || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await onAdopt(trim.id, field, dealerUserId);
      setOpenField(null);
    } catch {
      // 팝오버를 열어둔 채 알린다 — 닫으면 실패가 조용히 사라지고, 관리자는 채택된 줄 안다.
      setFailed("adopt");
    } finally {
      setBusy(false);
    }
  }

  async function undoAdoption(field: DiscountField) {
    if (!onUndo || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await onUndo(trim.id, field);
      // 채택과 달리 **닫지 않는다** — 갱신된 "현재 확정"이 제자리에서 바뀌는 게 결과 확인이고,
      // 토글 의미론이라 같은 버튼이 곧바로 "다시 그 값으로" 역할을 한다.
    } catch {
      setFailed("undo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {DISCOUNT_FIELDS.map((field) => {
        const confirmed = trim[TRIM_AMOUNT_KEYS[field]] as number | null;
        // 그 필드에 실제로 금액을 낸 제안만 센다 — 자사만 낸 딜러가 제휴 셀에 뜨면 오해가 된다.
        const offers = entry?.proposals.filter((p) => p[field].amount !== null) ?? [];
        const adoptedInfo = entry?.adopted[field];
        const sourceName = adoptedInfo?.sourceDealerUserId
          ? (entry?.proposals.find((p) => p.dealerUserId === adoptedInfo.sourceDealerUserId)?.dealerNote ??
            entry?.proposals.find((p) => p.dealerUserId === adoptedInfo.sourceDealerUserId)?.dealerName ??
            "딜러")
          : null;
        const open = openField === field;

        return (
          <td className="va-num va-c-disc va-disc-cell" key={field}>
            {offers.length === 0 || !onAdopt ? (
              discountText(confirmed, trim.price)
            ) : (
              <button
                aria-label={`${DISCOUNT_FIELD_LABELS[field]} 딜러 제안 ${offers.length}건 보기`}
                className="va-disc-open"
                onClick={() => setOpenField(open ? null : field)}
                type="button"
              >
                {discountText(confirmed, trim.price)}
                <span className="va-disc-count">{offers.length}</span>
              </button>
            )}

            {open && (
              <DiscountPopover heightDep={failed} popRef={popRef}>
                <div className="va-disc-pop-head">
                  {DISCOUNT_FIELD_LABELS[field]} — {trim.trimName}
                  {trim.mcCode ? <span className="va-disc-pop-code">{trim.mcCode}</span> : null}
                </div>
                <div className="va-disc-pop-now">
                  {/* 텍스트와 <strong>을 div로 묶는다 — flex column의 직접 자식이 되면 각각
                      익명 flex item이 되어 "현재 확정:"과 금액이 줄바꿈된다(실기에서 확인). */}
                  <div className="va-disc-pop-now-line">
                    <div>
                      현재 확정: <strong>{discountText(confirmed, trim.price)}</strong>
                    </div>
                    {/* 되돌리기 — 대상이 "현재 확정"이므로 이 줄에 산다(딜러 행에 붙이면 관리자
                        직접 입력 출처일 때 버튼 놓을 자리가 없다). 감사 이력이 없으면 숨기지 않고
                        **비활성**한다(유슨생 2026-07-29) — 자리가 유지되고 사유는 title이 말한다.
                        무엇으로 돌아가는지도 title로 미리 보여준다 — 이 팝오버의 원칙(무엇을 덮는지
                        모르고 누르지 않게) 그대로. */}
                    {onUndo ? (
                      <button
                        className="tiny-btn va-disc-undo"
                        disabled={busy || !adoptedInfo?.adoptedAt}
                        onClick={() => void undoAdoption(field)}
                        title={
                          adoptedInfo?.adoptedAt
                            ? `직전 값 ${discountText(adoptedInfo.previousAmount, trim.price)}(으)로 되돌립니다.`
                            : "되돌릴 채택 이력이 없습니다."
                        }
                        type="button"
                      >
                        {busy ? "…" : "↩ 되돌리기"}
                      </button>
                    ) : null}
                  </div>
                  {/* 출처 갈래: 되돌림(출처 이어받음/불명) · 딜러 채택 · 관리자 직접 입력(source
                      NULL) · 이력 없음. 직접 입력 갈래를 빼먹으면 관리자가 직접 넣은 값에 옛 딜러
                      채택이 출처로 붙어 **거짓이 된다**(2026-07-28 실기 — 그때는 감사 자체가 안
                      남았다). 되돌림은 복원된 값의 원 출처를 이어받으므로(쿼리 주석) 딜러명이
                      있으면 "○○ 값으로 되돌림"이 정확한 서술이다. */}
                  {adoptedInfo?.adoptedAt ? (
                    <span className="va-disc-pop-src">
                      {adoptedInfo.isUndo
                        ? sourceName
                          ? `${sourceName} 값으로 되돌림 · ${fmtDate(adoptedInfo.adoptedAt)}`
                          : `되돌림 · ${fmtDate(adoptedInfo.adoptedAt)}`
                        : sourceName
                          ? `출처 ${sourceName} · ${fmtDate(adoptedInfo.adoptedAt)} 채택`
                          : `관리자 직접 입력 · ${fmtDate(adoptedInfo.adoptedAt)}`}
                    </span>
                  ) : (
                    <span className="va-disc-pop-src">채택 이력 없음</span>
                  )}
                </div>

                <ul className="va-disc-list">
                  {offers.map((p) => {
                    const badge = STATE_BADGE[p[field].state];
                    return (
                      <li className="va-disc-row" key={p.dealerUserId}>
                        <span className="va-disc-dealer" title={p.dealerName ?? undefined}>
                          {p.dealerNote ? (
                            <>
                              {p.dealerNote}
                              <span className="va-disc-person">{p.dealerName ?? "이름 없음"}</span>
                            </>
                          ) : (
                            // 딜러사명(dealer_profiles.note)이 비어 있으면 **사람 이름을 주로** 올린다.
                            // "(딜러사 미지정)"을 굵게 띄우면 정작 누가 낸 제안인지가 회색 보조 줄로
                            // 밀린다(실기에서 확인). 비고는 조직 화면에서 채우면 위로 올라온다.
                            (p.dealerName ?? "이름 없음")
                          )}
                        </span>
                        <span className="va-disc-amount">{discountText(p[field].amount, trim.price)}</span>
                        {!p.isDealer ? (
                          // 자격 상실 — 서버도 같은 기준으로 거부하므로 버튼을 아예 주지 않는다.
                          <span className="va-disc-badge muted" title="이 사람은 현재 딜러가 아닙니다.">
                            채택 불가
                          </span>
                        ) : !p.brandMatches ? (
                          // 담당 브랜드가 바뀐 딜러(이직) — 데이터는 지우지 않으므로 브랜드를
                          // 되돌리면 이 제안을 그대로 다시 채택할 수 있다. 그 사실을 title에 남긴다.
                          <span
                            className="va-disc-badge muted"
                            title="이 딜러의 담당 브랜드가 바뀌었습니다 — 브랜드를 되돌리면 이 제안을 다시 채택할 수 있습니다."
                          >
                            브랜드 변경됨
                          </span>
                        ) : badge ? (
                          <span className={`va-disc-badge ${badge.tone}`} title={badge.hint}>
                            {badge.text}
                          </span>
                        ) : (
                          <span className="va-disc-badge" />
                        )}
                        {p.isDealer && p.brandMatches && p[field].state !== "adopted" ? (
                          <button
                            className="tiny-btn va-disc-adopt"
                            disabled={busy}
                            onClick={() => void adopt(field, p.dealerUserId)}
                            type="button"
                          >
                            {busy ? "…" : "채택"}
                          </button>
                        ) : (
                          <span />
                        )}
                      </li>
                    );
                  })}
                </ul>

                {failed && (
                  <div className="va-disc-fail">
                    {failed === "undo" ? "되돌리기에 실패했습니다 — 다시 시도해 주세요." : "채택에 실패했습니다 — 다시 시도해 주세요."}
                  </div>
                )}
              </DiscountPopover>
            )}
          </td>
        );
      })}
    </>
  );
}
