// 출고 정보 팝오버 — 고객 관리 콘솔 "출고 정보" 셀이 여는 폼형 편집기.
// 2026-08-05에 CustomerManagementRow.tsx(951줄)에서 통째로 분리했다. 셀(CustomerDeliveryInfoCell)은
// 요약 줄 버튼만 그리고 본문은 여기가 소유한다.
// ⚠️ 분리 단위는 이 컴포넌트 **전체**다 — 출고 8필드와 정산 섹션은 한 저장 경로(onSave 한 번의 PUT)를
// 공유하므로 정산만 떼면 입금일·실입금액·비용이 계약 필드와 갈라져 나간다.
import { useEffect, useRef, useState } from "react";
import { type CustomerSettlementPatch, SETTLEMENT_COST_KINDS, SETTLEMENT_STATUS_OPTIONS, type SettlementCostKind, type SettlementStatus } from "@/data/customers";
import { DateTextField } from "@/components/DateTextField";
// 금액 칸 입력 포맷 SSOT(구매조건 초기비용과 같은 한 벌) — 숫자 외 문자를 지우고 천단위 콤마를
// 넣는다. 저장 파서(resolveSettlementSubmit·resolveSettlementCosts)가 콤마를 다시 벗기므로
// 표시와 저장이 어긋나지 않는다.
import { formatNumberWithCommas } from "@/lib/detail-utils";
import { resolveSettlementSubmit, type DeliveryInfoDraft, type SeedableDeliveryField } from "@/lib/delivery-info";
import { fetchCustomerSettlement, requestCustomerSettlement } from "@/lib/customer-children";
import { formatSettlementMargin, resolveSettlementCosts, type SettlementCostDraft } from "@/lib/settlement";
import { bindSelect } from "@/lib/select-bind";
import { SOLUTION_LENDERS } from "@/lib/solution-quote";
import { useFixedPopoverPosition } from "@/lib/use-fixed-popover-position";

// 출고 정보 팝오버 — 폼형(명시 저장·취소: 담당자 변경/고객 등록 관례. 출고 예정의 무취소·경량형과 다른 분류
// — spec §5.3·B#10 각주). fixed 배치·notice 높이 재계산·스크롤 닫기는 출고 예정 팝오버(T13)와 동일 기계장치.
// 팝오버는 열릴 때 마운트되므로 useState(draft) 초기값이 곧 시드 — 재오픈마다 새로 시드된다.
export function DeliveryInfoPopover({ canEditSettlement, customerId, customerName, draft: initialDraft, notice, saving, onCancel, onSave }: {
  canEditSettlement: boolean;
  customerId: string | null;
  customerName: string;
  draft: DeliveryInfoDraft;
  notice: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: DeliveryInfoDraft, settlement: CustomerSettlementPatch | null) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  // 정산은 목록 응답에 없다(admin 전용 라우트로만 나간다) — 팝오버가 열릴 때 따로 조회한다.
  // 입금액은 문자열로 들고 있다가 저장 때 파싱한다(입력 중 콤마·빈 칸을 그대로 두기 위해).
  const [settledAt, setSettledAt] = useState("");
  const [feeText, setFeeText] = useState("");
  // 비용 행은 **금액을 문자열로** 들고 있다가 저장 때 한 번 파싱한다(입력 중 콤마·빈 칸 허용).
  const [costs, setCosts] = useState<SettlementCostDraft[]>([]);
  // 정산 단계 — 담당자가 올린 "정산요청"을 admin이 여기서 보고 "정산완료"로 넘긴다(그 전이의 유일한
  // 화면). **조회값을 따로 보관**해 저장 때 바뀐 경우에만 싣는다 — 아래 저장 핸들러 주석 참조.
  const [status, setStatus] = useState<SettlementStatus>("미정산");
  const [loadedStatus, setLoadedStatus] = useState<SettlementStatus>("미정산");
  const [settlementError, setSettlementError] = useState<string | null>(null);
  // 정산 조회가 **실제로 도착했는지**. 이게 없으면 아래 두 결함이 동시에 산다(2026-08-06 배치 16):
  //  ① 저장이 빈 state를 "빈 값"으로 단정해 `{settledAt:null, feeAmount:null, costs:[]}`를 보낸다 →
  //     기존 실입금액·입금일·비용이 **지워진다**(이력 테이블·트리거가 없어 복구 불가).
  //     서버의 부분 SET은 *팝오버(금액) ↔ 담당자 요청(status)* 축 분리라 이걸 막아주지 않는다.
  //  ② 거울면 — 늦게 도착한 응답이 **admin이 입력 중이던 값을 덮는다**.
  // 그래서 도착 전에는 **입력 자체를 렌더하지 않고**(②를 원천 차단) 저장에서도 정산을 뺀다(①).
  const [settlementLoaded, setSettlementLoaded] = useState(false);
  // 담당자 정산 요청 결과 — 상태를 미리 조회하지 않는다(담당자는 정산을 읽을 수 없다).
  // 버튼은 항상 눌리고 **서버가 판단**한다: 이미 요청/완료면 409 문구가 그대로 여기에 담긴다.
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  useEffect(() => {
    if (!canEditSettlement || !customerId) return;
    let cancelled = false;
    fetchCustomerSettlement(customerId)
      .then((s) => {
        if (cancelled) return;
        setSettledAt(s.settledAt ?? "");
        // 불러올 때도 같은 포맷으로 — 저장된 값만 콤마가 없으면 방금 입력한 값과 표기가 어긋난다.
        setFeeText(s.feeAmount == null ? "" : formatNumberWithCommas(String(s.feeAmount)));
        setCosts((s.costs ?? []).map((c) => ({ kind: c.kind, label: c.label, amountText: formatNumberWithCommas(String(c.amount)) })));
        // 출고 행이 아직 없는 고객은 라우트가 status를 "미정산"으로 채워 주지만, 구 응답·부분
        // 페이로드에도 select가 빈 값이 되지 않도록 여기서 한 번 더 받는다(controlled select라
        // undefined면 uncontrolled로 떨어져 Safari 바인딩 규칙이 무의미해진다).
        const next = s.status ?? "미정산";
        setStatus(next);
        setLoadedStatus(next);
        setSettlementLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSettlementError("정산 정보를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [canEditSettlement, customerId]);
  const rootRef = useRef<HTMLDivElement>(null);
  // heightDep에 notice 문자열 자체를 넘긴다(Boolean 금지 — DeliverySchedulePopover와 같은 사유).
  const pos = useFixedPopoverPosition(rootRef, ".delivery-info-wrap", notice);
  // 사용자가 고친 칸은 더 이상 "견적에서 가져온" 값이 아니므로 힌트를 뗀다(남으면 거짓 표시).
  const set = (patch: Partial<DeliveryInfoDraft>) =>
    setDraft((d) => ({ ...d, ...patch, seededFields: d.seededFields.filter((f) => !(f in patch)) }));
  // 프리필 힌트 — 저장값이 없어 견적으로 채운 칸에만 붙는다(soft pipe 규칙의 가시화, spec §5.3).
  // ⚠️ aria-hidden 필수: 라벨 안에 있어서 그냥 두면 접근성 이름이 "계약 차량견적에서 가져옴"이 되고,
  // 라벨로 요소를 찾는 코드·테스트가 전부 깨진다(getByLabelText 정확 일치 — 실제로 잡혔다).
  // 값 자체는 input에서 읽히므로 보조 표시를 빼도 정보 손실이 아니다.
  const seedHint = (field: SeedableDeliveryField) =>
    draft.seededFields.includes(field) ? (
      <em aria-hidden="true" className="delivery-seed-hint">견적에서 가져옴</em>
    ) : null;
  return (
    <div
      aria-label="출고 정보 편집"
      className="delivery-info-popover"
      onClick={(event) => event.stopPropagation()}
      // Enter만 차단(배치 11 B#1) — 입력 필드의 Enter keydown이 행까지 버블되면 openCustomerByKeyboard가
      // 드로어를 팝오버 위로 연다. 무차별 stopPropagation은 dismiss 훅의 Escape 닫기(document 버블
      // 리스너)를 죽이는 회귀(적대 검증 V2)라 금지.
      onKeyDown={(event) => { if (event.key === "Enter") event.stopPropagation(); }}
      ref={rootRef}
      role="dialog"
      // 내용이 가변이라(비용 행을 계속 추가할 수 있다) 위아래 어디에도 안 들어가는 길이가 될 수
      // 있다 — 그때 배치 훅은 아래로 붙이고, maxHeight가 없으면 넘친 부분이 조용히 잘린다
      // (2026-08-05 실화면: "실입금액" 아래가 통째로 안 보였다). 남는 공간만큼으로 제한하고 스크롤.
      style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { visibility: "hidden" }}
    >
      {/* 폼형 관례(담당자 변경·고객 삭제·고객 등록 전부 가시 타이틀) + fixed 분리 대비 고객명 병기(배치 11 C#1·spec §6) */}
      <strong className="delivery-info-title">출고 정보 — {customerName}</strong>
      <label><span>계약 차량{seedHint("contractVehicle")}</span><input onChange={(e) => set({ contractVehicle: e.target.value })} type="text" value={draft.contractVehicle} /></label>
      <label><span>계약일</span><DateTextField onValueChange={(v) => set({ contractDate: v })} value={draft.contractDate} /></label>
      <label>
        <span>금융사{seedHint("lender")}</span>
        <input list="delivery-lender-options" onChange={(e) => set({ lender: e.target.value })} type="text" value={draft.lender} />
        <datalist id="delivery-lender-options">{SOLUTION_LENDERS.map((l) => <option key={l.code} value={l.label} />)}</datalist>
      </label>
      <label><span>출고 실측일</span><DateTextField onValueChange={(v) => set({ deliveredDate: v })} value={draft.deliveredDate} /></label>
      {/* 계약 확정일 = **실적 귀속 기준**(2026-08-03 이사님). 인도 후 URL 인증까지 끝난 날이고,
          월을 넘기면 확정된 달의 실적이다. 위 실측일과 나란히 두되 라벨을 구분한다 — 현장에서는
          둘 다 "출고"라 부르지만 여기서는 어느 칸에 뭘 넣을지 명확해야 한다. */}
      <label><span>계약 확정일</span><DateTextField onValueChange={(v) => set({ contractConfirmedDate: v })} value={draft.contractConfirmedDate} /></label>
      <label><span>탁송/정비 메모</span><textarea onChange={(e) => set({ deliveryMemo: e.target.value })} rows={3} value={draft.deliveryMemo} /></label>
      {/* 정산 — admin에게만 렌더된다. 서버가 진짜 게이트이고(requireRoles) 이건 UI 보조다. */}
      {canEditSettlement && (
        <div className="delivery-settlement">
          <strong className="delivery-settlement-title">정산 <span className="badge">관리자</span></strong>
          {/* 조회 도착 전에는 **입력을 비활성**으로 둔다 — 빈 입력에 손대는 순간 그 값이 저장 대상이
              되고, 도착한 응답이 그 입력을 덮는다(위 settlementLoaded 주석의 ①②).
              ⚠️ 섹션을 통째로 갈아끼우지 않는 이유: 팝오버 높이가 변하면 useFixedPopoverPosition이
              위치를 다시 잡아 열자마자 화면이 튄다. fieldset은 하위 입력을 브라우저가 한 번에 막아
              주므로 입력마다 disabled를 다는 것보다 누락 위험이 없다(CSS 리셋은 index.css). */}
          <fieldset className="delivery-settlement-fields" disabled={!settlementLoaded}>
          {/* 단계를 섹션 **맨 위**에 둔다 — 담당자가 올린 "정산요청"을 **바꿀 수 있는 유일한 접점**이라
              열자마자 눈에 들어와야 한다(2026-08-05 정산 탭 목록에 단계 배지가 생겨 "어디에도 안
              보인다"는 더는 사실이 아니다. 다만 그 탭은 조회 전용이고 편집 표면은 여기 하나다).
              controlled select라 bindSelect 필수(Safari onInput 병행 — 안 하면 선택이 통째로 유실된다). */}
          <label>
            <span>단계</span>
            <select
              className={status === "정산요청" ? "settlement-status-requested" : undefined}
              {...bindSelect(status, (v) => setStatus(v as SettlementStatus))}
            >
              {SETTLEMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label><span>입금일</span><DateTextField onValueChange={setSettledAt} value={settledAt} /></label>
          <label>
            <span>실입금액</span>
            <span className="delivery-fee-input">
              <input inputMode="numeric" onChange={(e) => setFeeText(formatNumberWithCommas(e.target.value))} type="text" value={feeText} />
              <em>원</em>
            </span>
          </label>
          {/* 비용 항목(2026-08-04 이사님 확정 5종) — 마진은 저장하지 않고 여기서 파생 표시한다. */}
          <div className="settlement-costs">
            <span className="settlement-costs-label">비용</span>
            {costs.map((c, i) => (
              <div className="settlement-cost-row" key={i}>
                {/* controlled select — Safari onInput 병행 바인딩 규칙(bindSelect). */}
                <select
                  aria-label={`비용 ${i + 1} 종류`}
                  {...bindSelect(c.kind, (v) =>
                    setCosts((rows) => rows.map((r, j) => (j === i ? { ...r, kind: v as SettlementCostKind } : r))),
                  )}
                >
                  {SETTLEMENT_COST_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                {/* 직접입력에만 항목명 칸이 열린다 — 고정 항목에 이름을 붙이면 집계 키가 갈린다. */}
                {c.kind === "직접입력" && (
                  <input
                    aria-label={`비용 ${i + 1} 항목명`}
                    onChange={(e) => setCosts((rows) => rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                    placeholder="항목명"
                    type="text"
                    value={c.label ?? ""}
                  />
                )}
                {/* 단위는 실입금액 칸과 같은 패턴(.delivery-fee-input)으로 칸 안 오른쪽에 붙인다 —
                    같은 섹션에서 한쪽만 "원"이 없으면 어느 단위인지 매번 확인하게 된다. */}
                <span className="delivery-fee-input settlement-cost-amount">
                  <input
                    aria-label={`비용 ${i + 1} 금액`}
                    inputMode="numeric"
                    onChange={(e) => setCosts((rows) => rows.map((r, j) => (j === i ? { ...r, amountText: formatNumberWithCommas(e.target.value) } : r)))}
                    type="text"
                    value={c.amountText}
                  />
                  <em>원</em>
                </span>
                <button aria-label={`비용 ${i + 1} 삭제`} onClick={() => setCosts((rows) => rows.filter((_, j) => j !== i))} type="button">✕</button>
              </div>
            ))}
            <button
              className="settlement-cost-add"
              onClick={() => setCosts((rows) => [...rows, { kind: SETTLEMENT_COST_KINDS[0], label: null, amountText: "" }])}
              type="button"
            >
              + 비용 추가
            </button>
            {/* 마진 = 실입금액 − 비용합(파생·미저장). 실입금액이 비면 "—"로 둔다 — 0원과 "모른다"는 다르다. */}
            <p className="settlement-margin">
              마진 <strong>{formatSettlementMargin(feeText, costs)}</strong>
            </p>
          </div>
          {settlementError && <p className="delivery-schedule-notice" role="alert">{settlementError}</p>}
          </fieldset>
        </div>
      )}
      {/* 담당자 정산 요청(2026-08-04 이사님 확정) — **admin이 아니어도 보인다**. 정산 금액은 계속
          안 보이고, 이 버튼이 하는 일은 미정산 → 정산요청 전이 하나뿐이다. 상태를 미리 조회하지
          않으므로(담당자는 정산을 읽을 수 없다) 항상 눌리고 결과는 서버가 알려준다. */}
      {customerId && (
        <div className="settlement-request">
          <button
            disabled={requesting || saving}
            onClick={() => {
              setRequesting(true);
              setRequestNotice(null);
              requestCustomerSettlement(customerId)
                .then(() => setRequestNotice("정산을 요청했습니다."))
                .catch((e: unknown) => setRequestNotice(e instanceof Error ? e.message : "정산 요청에 실패했습니다."))
                .finally(() => setRequesting(false));
            }}
            type="button"
          >
            {requesting ? "요청 중…" : "정산 요청"}
          </button>
          {requestNotice && <p className="delivery-schedule-notice" role="status">{requestNotice}</p>}
        </div>
      )}
      {notice && <p className="delivery-schedule-notice" role="alert">{notice}</p>}
      <div className="delivery-schedule-actions">
        <button disabled={saving} onClick={onCancel} type="button">취소</button>
        <button
          disabled={saving}
          onClick={() => {
            if (!canEditSettlement) return onSave(draft, null);
            // 조회가 아직 안 왔거나 실패했으면 **정산은 건드리지 않는다**(위 settlementLoaded 주석).
            // 출고 정보 저장까지 막지는 않는다 — 정산 조회 실패가 다른 편집을 인질로 잡으면 안 된다.
            if (!settlementLoaded) return onSave(draft, null);
            const submit = resolveSettlementSubmit(settledAt, feeText);
            if (submit.kind === "invalid") return setSettlementError(submit.reason);
            // 비용도 같은 저장에 실어 보낸다 — 따로 호출하면 한쪽만 성공하는 창이 생긴다.
            const resolvedCosts = resolveSettlementCosts(costs);
            if (resolvedCosts.kind === "invalid") return setSettlementError(resolvedCosts.reason);
            setSettlementError(null);
            // ⚠️ 단계는 **조회 이후 실제로 바뀐 경우에만** 싣는다(patch가 부분인 이유 그 자체).
            // 항상 보내면, admin이 팝오버를 열어 둔 사이 담당자가 올린 "정산요청"을 저장 한 번으로
            // 조용히 "미정산"으로 되돌린다 — 요청이 사라진 걸 양쪽 다 모른다.
            const statusPatch = status === loadedStatus ? {} : { status };
            onSave(draft, { ...submit.body, costs: resolvedCosts.costs, ...statusPatch });
          }}
          type="button"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
