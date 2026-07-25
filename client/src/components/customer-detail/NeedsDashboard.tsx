import { CarFront, MessageSquareText, Star, X } from "lucide-react";
import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import { type CustomerDetailData } from "@/lib/customers";

import { WorkbenchVehiclePicker, type VehicleSelection } from "./WorkbenchVehiclePickers";

import { NEEDS_COLOR_PLACEHOLDER } from "./needs-meta";
import { methodOptions } from "./purchase-meta";
import { type OpenEditorState } from "./types";
import type { useCustomerNeeds } from "./hooks/useCustomerNeeds";

type NeedsDashboardProps = {
  detail: CustomerDetailData; // appUserId로 앱 카드 목록 / 단일 need 카드 분기
  onToast: (message: string) => void;
  // 부모 소유 공유 인프라(상태·구매조건도 사용) — props로 받는다.
  openEditor: OpenEditorState | null;
  setOpenEditor: Dispatch<SetStateAction<OpenEditorState | null>>;
  toggleEditor: (next: OpenEditorState) => void;
  editorRef: RefObject<HTMLDivElement | null>;
  // 워크벤치 소유(Task 9 미추출, 부모 보유) — 앱 카드 "견적 작성"이 호출만 한다.
  openWorkbenchForQuoteRequest: (reqId: string) => Promise<void>;
  // 승격 견적 "견적 보기"(부모가 quoteList에서 찾아 openEditQuote, 미발견 시 openWorkbenchForQuoteRequest로 폴백 — 고정 설계 결정 5).
  onViewQuote: (reqId: string, quoteId: string) => void;
  needsHook: ReturnType<typeof useCustomerNeeds>;
  // 견적 쓰기 권한(2026-07-21 이사님 D-4 ②) — false면 "견적 작성"/"추가 작성" 숨김("견적 보기"는 읽기라 유지).
  quoteWritable: boolean;
};

export function NeedsDashboard({ detail, onToast, openEditor, setOpenEditor, toggleEditor, editorRef, openWorkbenchForQuoteRequest, onViewQuote, needsHook, quoteWritable }: NeedsDashboardProps) {
  const { needs, appRequests, consultations, handlers } = needsHook;
  const { saveNeeds, dismissConsultation } = handlers;
  // 상담신청 카드 삭제는 되돌리는 UI가 없어(재조회해도 dismissed 제외) 오클릭 방지용 인라인 확인 —
  // X 한 번은 "삭제/취소" 확인 상태로만 전환, 실제 삭제는 "삭제"를 한 번 더 눌러야 실행.
  const [confirmingConsultId, setConfirmingConsultId] = useState<string | null>(null);
  // 관심 차량 선택(2026-07-24) — 수기 텍스트 대신 catalog 3단 픽커. null = 이 폼에서 아직 안 골랐음
  // (기존 detail 값을 그대로 저장한다). 서버 파생(vehicleNeedsOf)과 **같은 형식**으로 만든다:
  // needModel = "브랜드 모델", needTrim = 트림명. 형식이 갈리면 목록에서 같은 차가 달라 보인다.
  const [vehiclePick, setVehiclePick] = useState<{ model: string; trim: string; trimId: number | null } | null>(null);

  function onVehiclePicked(sel: VehicleSelection) {
    setVehiclePick({
      model: [sel.brand?.name, sel.model?.name].filter(Boolean).join(" "),
      trim: sel.trim ? (sel.trim.trimName ?? sel.trim.name) : "",
      trimId: sel.trim?.id ?? null,
    });
  }

  function renderNeedsEditor() {
    return (
      <div className="kim-edit-popover needs" role="dialog" aria-label="고객 니즈 수정">
        <form className="kim-edit-form needs" onSubmit={saveNeeds}>
          {/* 관심 차량 = catalog 3단 픽커(제조사·모델·트림 가로). 수기 텍스트를 없앤 이유: 표기가
              제각각이라 데이터로 못 썼다(실측 2026-07-24: 23건 중 catalog 형식 2건). 그 값이 목록
              차종 열·AI 프로필 임베딩 청크로 그대로 흘러간다.
              값은 hidden으로 넘겨 기존 FormData 저장 경로를 그대로 쓴다. */}
          <div className="kim-needs-vehicle-picker">
            <WorkbenchVehiclePicker compact initialTrimId={detail.needTrimId ?? undefined} onChange={onVehiclePicked} />
          </div>
          <input name="model" type="hidden" value={vehiclePick?.model ?? needs.model} />
          <input name="trim" type="hidden" value={vehiclePick?.trim ?? needs.trim} />
          <input name="trimId" type="hidden" value={vehiclePick ? (vehiclePick.trimId ?? "") : (detail.needTrimId ?? "")} />
          <div className="kim-edit-grid">
            <label>
              <span>색상</span>
              <input defaultValue={needs.colors} name="colors" />
            </label>
            <label>
              <span>구매방식</span>
              {/* 빈 값("미정") 옵션 — 없으면 need_method가 비어 있어도 첫 옵션(장기렌트)이 선택된 것처럼
                  보이고, 관심 차종만 입력하고 저장해도 구매방식에 장기렌트가 박혔다(2026-07-24).
                  비어 있음을 고를 수단이자, 잘못 넣은 값을 되돌리는 수단이다.
                  목록 **맨 아래**에 둔다(유슨생 결정) — 실제 구매방식이 위에 모여야 고르기 쉽다.
                  위치는 선택 동작과 무관하다: `defaultValue=""`가 value로 매칭되므로 어디 있든 자동 선택된다. */}
              <select defaultValue={needs.method} name="method">
                {methodOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                <option value="">미정</option>
              </select>
            </label>
          </div>
          <label>
            <span>문의사항</span>
            <textarea defaultValue={needs.memo} name="memo" rows={4} />
          </label>
          <div className="kim-edit-actions">
            <button type="button" onClick={() => { setVehiclePick(null); setOpenEditor(null); }}>취소</button>
            <button className="primary" type="submit">저장</button>
          </div>
        </form>
      </div>
    );
  }

  // 수기 니즈 카드(편집 진입점). 앱 카드 모드에서도 대표 견적요청이 없으면 이 카드를 쓴다 —
  // 두 자리가 같은 벌을 공유해야 한판만 고치는 드리프트가 안 생긴다.
  function renderNeedsCard() {
    return (
      <div className="kim-edit-anchor needs" ref={openEditor?.kind === "needs" ? editorRef : undefined}>
        <button className="kim-needs-floating-card" onClick={() => toggleEditor({ kind: "needs" })} type="button">
          <div className="kim-needs-card-main">
            <span className="kim-needs-car-icon" aria-hidden="true"><CarFront size={22} strokeWidth={2.1} /></span>
            <div className="kim-needs-card-copy">
              <h3>{needs.model}</h3>
              <p>{needs.trim}</p>
              <span>{needs.colors}</span>
            </div>
            <span className="kim-needs-method-badge">{needs.method}</span>
          </div>
          <div className="kim-needs-card-memo">
            <span>문의사항</span>
            <p>{needs.memo}</p>
          </div>
        </button>
        {openEditor?.kind === "needs" ? renderNeedsEditor() : null}
      </div>
    );
  }

  // 니즈를 수기로 쓸 수 있는가 = **대표 견적요청이 없는가**(app_user_id 아님 — 설계 D2).
  // 서버 PATCH 409 게이트(routes/customers.ts)가 쓰는 판정과 같은 기준이어야 한다: 상담신청으로만
  // 유입돼 견적요청이 0건인 앱 고객은 파생 소스가 없어 수기 입력이 계속 열려 있어야 하는데,
  // 화면이 app_user_id로 갈라 편집 진입점을 통째로 숨기고 있었다(2026-07-25).
  const needsEditable = !detail.featuredRequestId;

  return (
    <section className={`detail-section kim-needs-dashboard${detail.appUserId ? " is-app" : ""}`}>
      <div className="kim-needs-field">
        {detail.appUserId ? (
          <div className="kim-needs-app">
            {/* 대표가 없으면(요청 0건 등) 수기 편집 카드를 스택 위에 고정한다. 스크롤 영역 **밖**인
                이유: 편집 팝오버가 overflow:auto 안에서 잘린다. */}
            {needsEditable ? <div className="kim-needs-manual-slot">{renderNeedsCard()}</div> : null}
            {/* 카드 목록만 상한 높이 스크롤(overscroll-contain으로 부모 드로어 스크롤 격리) */}
            <div className="kim-needs-request-scroll">
              {(() => {
                const requestCards = appRequests ?? [];
                const consultCards = consultations ?? [];
                const nothingYet = requestCards.length === 0 && consultCards.length === 0;
                if ((appRequests === null || consultations === null) && nothingYet) {
                  return <p className="kim-needs-request-status">앱 견적요청·상담신청 불러오는 중…</p>;
                }
                if (nothingYet) {
                  return <p className="kim-needs-request-status">앱 견적요청·상담신청이 없습니다.</p>;
                }
                return (
                  <>
                    {requestCards.map((req) => {
                      // "견적 작성"/"추가 작성" 공용 핸들러 — 토스트 문구·에러 처리 1벌(한쪽만 고치는 드리프트 방지).
                      const createQuote = () => { void openWorkbenchForQuoteRequest(req.id).catch(() => onToast("견적요청 정보를 불러오지 못했습니다.")); };
                      return (
                      <div className="kim-needs-floating-card kim-needs-request-card" key={req.id}>
                        <div className="kim-needs-card-main">
                          <span className="kim-needs-car-icon" aria-hidden="true"><CarFront size={22} strokeWidth={2.1} /></span>
                          <div className="kim-needs-card-copy">
                            {/* 차량은 모델 줄 · 트림 줄 2줄 — 수기 니즈 카드와 같은 배치다(둘이 한 줄/두 줄로
                                갈려 있어 같은 화면에서 다른 카드처럼 보였다, 2026-07-25). 트림이 없으면 줄째로 숨긴다. */}
                            <h3>{req.vehicleModelLabel}</h3>
                            {req.vehicleTrimLabel ? <p>{req.vehicleTrimLabel}</p> : null}
                            <span>{req.paymentLabel} · 옵션 {req.optionLabel}{req.colorLabel ? ` · ${req.colorLabel}` : ""}</span>
                            {/* 계약 조건과 출고는 한 줄로 묶는다(유슨생 결정 2026-07-25) — 둘 다 짧아
                                각자 한 줄을 쓰면 카드만 길어졌다. 출고·문의는 V2 요청에만 있어 레거시
                                행에서는 " | 출고:" 자체가 안 붙는다(구분자 잔재 없음). */}
                            <span>{req.periodLabel} · {req.depositLabel}{req.deliveryLabel ? ` | 출고: ${req.deliveryLabel}` : ""}</span>
                            {req.topicLabels.length > 0 ? <span>문의 {req.topicLabels.join(", ")}</span> : null}
                          </div>
                          <div className="kim-needs-request-actions">
                            {/* 대표 견적요청(설계 D1) — 켜진 카드의 값이 목록 차종·구매방식과 상세 구매조건 5필드가 된다.
                                해제는 없다(항상 1건). 배지가 없는 카드에서도 star는 늘 보여야 해서 같은 줄로 묶는다. */}
                            <div className="kim-needs-request-badge-row">
                              <button
                                aria-label={req.id === detail.featuredRequestId ? "대표 견적요청" : "대표 견적요청으로 지정"}
                                aria-pressed={req.id === detail.featuredRequestId}
                                className={`kim-needs-request-star${req.id === detail.featuredRequestId ? " is-on" : ""}`}
                                onClick={() => handlers.featureRequest(req.id)}
                                title={req.id === detail.featuredRequestId ? "대표 견적요청" : "대표 견적요청으로 지정"}
                                type="button"
                              >
                                <Star size={16} strokeWidth={2.1} />
                              </button>
                              {req.promotedQuoteCount > 0 ? (
                                <span className="kim-needs-request-badge">견적 {req.promotedQuoteCount}건</span>
                              ) : null}
                            </div>
                            {req.promotedQuoteIds.length > 0 ? (
                              // 승격 견적 있음: 기본 액션은 중복 작성 방지를 위해 "견적 보기"(최신 승격 견적), "추가 작성"은 보조 액션으로 낮춤.
                              // 가로 한 줄(보조 왼쪽·기본 오른쪽 끝) — 배지+버튼 2줄 유지로 카드 높이 증가 방지.
                              <div className="kim-needs-request-button-row">
                                {quoteWritable ? (
                                  <button className="kim-needs-request-create-secondary" onClick={createQuote} type="button">
                                    추가 작성
                                  </button>
                                ) : null}
                                <button
                                  className="kim-needs-request-create"
                                  onClick={() => onViewQuote(req.id, req.promotedQuoteIds[0])}
                                  type="button"
                                >
                                  견적 보기
                                </button>
                              </div>
                            ) : quoteWritable ? (
                              <button className="kim-needs-request-create" onClick={createQuote} type="button">
                                견적 작성
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {/* 자유문의는 수기 니즈 카드·상담신청 카드와 **같은 하단 블록**으로 낸다(2026-07-25).
                            구 이탤릭 인용은 본문 줄에 섞여 라벨이 없었다. ⚠️ 값의 의미는 그대로 **요청별**이다
                            (카드마다 자기 문의) — 수기 카드의 문의사항이 고객 단위인 것과 다르다. */}
                        {req.additionalRequest ? (
                          <div className="kim-needs-card-memo">
                            <span>문의사항</span>
                            <p>{req.additionalRequest}</p>
                          </div>
                        ) : null}
                      </div>
                    );
                    })}
                    {/* 앱 상담신청 문의 카드(읽기 전용, 건별) — 견적요청 카드와 같은 스크롤 스택에 공존. 원본 문의 보존(편집 없음),
                        CRM에서만 삭제 가능(public.consultations 불가침 — dismissConsultation은 crm.consultation_dismissals에만 기록). */}
                    {consultCards.map((c) => (
                      <div className="kim-needs-floating-card kim-needs-consultation-card" key={c.id}>
                        <div className="kim-needs-consultation-actions">
                          {confirmingConsultId === c.id ? (
                            <>
                              <button
                                className="kim-needs-consultation-confirm"
                                type="button"
                                onClick={() => { setConfirmingConsultId(null); dismissConsultation(c.id); }}
                              >
                                삭제
                              </button>
                              <button
                                className="kim-needs-consultation-cancel"
                                type="button"
                                onClick={() => setConfirmingConsultId(null)}
                              >
                                취소
                              </button>
                            </>
                          ) : (
                            <button
                              className="kim-needs-consultation-delete"
                              type="button"
                              aria-label="상담신청 삭제 (CRM에서만, 앱에는 유지)"
                              title="CRM에서만 삭제 (앱 원본은 유지)"
                              onClick={() => setConfirmingConsultId(c.id)}
                            >
                              <X size={13} strokeWidth={2.6} />
                            </button>
                          )}
                        </div>
                        <div className="kim-needs-card-main">
                          <span className="kim-needs-car-icon" aria-hidden="true"><MessageSquareText size={22} strokeWidth={2.1} /></span>
                          <div className="kim-needs-card-copy">
                            <h3>{c.carModel?.trim() || "상담 문의"}</h3>
                            <p>상담신청 · {c.dateLabel}</p>
                          </div>
                        </div>
                        {c.notes?.trim() ? (
                          <div className="kim-needs-card-memo">
                            <span>문의사항</span>
                            <p>{c.notes}</p>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
            {/* 문의사항·관심 색상은 고객 단위(요청별 아님). 값 있을 때만 노출(스크롤 영역 밖 고정).
                수기 편집 카드가 떠 있으면 그 카드가 같은 두 값을 이미 보여주므로 중복을 피해 숨긴다. */}
            {!needsEditable && (needs.memo.trim() || (needs.colors.trim() && needs.colors !== NEEDS_COLOR_PLACEHOLDER)) ? (
              <div className="kim-needs-customer-meta">
                {needs.memo.trim() ? (
                  <div className="kim-needs-card-memo">
                    <span>문의사항</span>
                    <p>{needs.memo}</p>
                  </div>
                ) : null}
                {needs.colors.trim() && needs.colors !== NEEDS_COLOR_PLACEHOLDER ? (
                  <div className="kim-needs-card-memo">
                    <span>관심 색상</span>
                    <p>{needs.colors}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          renderNeedsCard()
        )}
      </div>
    </section>
  );
}
