import { useEffect, useState, type Dispatch, type SetStateAction, type SyntheticEvent } from "react";

import { dismissConsultation, fetchCustomerConsultationsCached, invalidateCustomerConsultations, type AppConsultation } from "@/lib/consultations";
import { type CustomerDetailData, type CustomerWritePatch } from "@/lib/customers";
import { featureQuoteRequest, fetchCustomerQuoteRequestsCached, type AppQuoteRequest } from "@/lib/quote-requests";

import { NEEDS_COLOR_PLACEHOLDER, type NeedsState } from "../needs-meta";
import { type OpenEditorState } from "../types";

type UseCustomerNeedsArgs = {
  detail: CustomerDetailData; // needs 초기값 매핑 소스 + appUserId(앱 카드 목록 fetch 여부) + id(앱 견적요청 fetch 키)
  onToast: (message: string) => void;
  // 부모 소유 공유 인프라(상태·구매조건도 사용). 훅은 인자로만 받아 쓴다.
  savePatch: (patch: CustomerWritePatch, rollback: () => void) => void;
  markRecentUpdate: (section: string) => void;
  setOpenEditor: Dispatch<SetStateAction<OpenEditorState | null>>;
  // 대표 견적요청 변경 결과를 상세에 즉시 반영 — 서버가 갱신된 파생 7필드를 응답에 실어 주므로
  // 상세를 다시 받지 않는다(prod 왕복 2회 = 눈에 띄는 딜레이, 2026-07-24 실기).
  applyDetailPatch: (patch: Partial<CustomerDetailData>) => void;
  // 목록 "차종·구매방식" 열을 그 행만 즉시 갱신 — 서버 응답에 갱신값이 실려 오므로 재페치를 기다리지 않는다.
  onVehicleChange?: (next: { vehicle?: string; vehicleTrim?: string; method?: string }) => void;
  // 목록 나머지 파생(lastActivity 등) 동기화용 재페치. 배경으로 흘린다 — 눈에 보이는 열은 위가 이미 고쳤다.
  onCustomerListChanged?: () => void;
};

export function useCustomerNeeds({
  detail,
  onToast,
  savePatch,
  markRecentUpdate,
  setOpenEditor,
  applyDetailPatch,
  onVehicleChange,
  onCustomerListChanged,
}: UseCustomerNeedsArgs) {
  const [needs, setNeeds] = useState<NeedsState>(() => ({
    model: detail.needModel ?? "",
    trim: detail.needTrim ?? "",
    colors: detail.needColors ?? NEEDS_COLOR_PLACEHOLDER,
    method: detail.needMethod ?? "",
    memo: detail.needMemo ?? "",
  }));
  // 앱 유입 고객(detail.appUserId)이면 그 고객의 앱 견적요청 카드 목록. 수기 고객은 null → 기존 단일 need 카드.
  const [appRequests, setAppRequests] = useState<AppQuoteRequest[] | null>(null);
  // 앱 유입 고객이면 그 고객의 앱 상담신청 문의 카드 목록(읽기 전용, 건별). 수기 고객은 null.
  const [consultations, setConsultations] = useState<AppConsultation[] | null>(null);

  // detail.appUserId 있으면 그 고객 요청 fetch(카드 목록). 없으면 null 유지(폴백 단일 카드).
  useEffect(() => {
    if (!detail.appUserId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 앱 고객 아니면 카드 목록 비움(외부 값 동기화)
      setAppRequests(null);
      return;
    }
    let cancelled = false;
    void fetchCustomerQuoteRequestsCached(detail.id)
      .then((r) => { if (!cancelled) setAppRequests(r); })
      .catch(() => { if (!cancelled) setAppRequests([]); });
    return () => { cancelled = true; };
  }, [detail.appUserId, detail.id]);

  // 상담신청은 읽기 전용(CRM 액션으로 변하지 않음) — reload 함수 없이 TTL+재마운트로 신선도 확보.
  useEffect(() => {
    if (!detail.appUserId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 앱 고객 아니면 상담신청 카드 비움(외부 값 동기화)
      setConsultations(null);
      return;
    }
    let cancelled = false;
    void fetchCustomerConsultationsCached(detail.id)
      .then((r) => { if (!cancelled) setConsultations(r); })
      .catch(() => { if (!cancelled) setConsultations([]); });
    return () => { cancelled = true; };
  }, [detail.appUserId, detail.id]);

  // 견적 승격 성공 후 배지(견적 N건) 갱신용 재fetch. 앱 고객일 때만 의미.
  // 워크벤치(Task 9 미추출, 부모 보유)가 견적 INSERT 성공 시 호출 → 훅이 반환하면 부모가 needs.reloadAppRequests()로 중계.
  function reloadAppRequests() {
    if (!detail.appUserId) return;
    void fetchCustomerQuoteRequestsCached(detail.id, true).then(setAppRequests).catch(() => undefined);
  }

  // CRM 전용 삭제(카드 숨김) — public.consultations는 불변, crm.consultation_dismissals에만 기록된다.
  // 낙관적 제거 + 실패 시 롤백(견적요청 link/create-customer의 낙관 패턴과 동형).
  function handleDismissConsultation(consultationId: string) {
    const prev = consultations;
    setConsultations((cur) => cur?.filter((x) => x.id !== consultationId) ?? cur);
    invalidateCustomerConsultations(detail.id);
    onToast("상담신청을 CRM에서 삭제했습니다.");
    void dismissConsultation(detail.id, consultationId).catch(() => {
      setConsultations(prev);
      onToast("상담신청 삭제에 실패했습니다.");
    });
  }

  // ⚠️ 폼 값을 **그대로** 쓴다(2026-07-24). 구 동작은 `입력값 || 기존값` 폴백이라 **한 번 넣은 값을
  // 지울 수 없었다** — 오타를 고치려 비우고 저장해도 옛 값이 되살아났다. 이제 비우면 비워진다.
  // 빈 문자열은 null로 보낸다(컬럼에 ""와 null이 섞이면 "빈 칸" 판정이 두 갈래가 된다).
  function saveNeeds(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const field = (name: string) => String(formData.get(name) ?? "").trim();
    const prevNeeds = needs;
    const nextNeeds = {
      model: field("model"),
      trim: field("trim"),
      colors: field("colors"),
      method: field("method"),
      memo: field("memo"),
    };
    // 관심 차량 catalog 링크 — 폼의 3단 픽커가 hidden으로 실어 보낸다. 빈 문자열이면 null(미선택).
    const trimIdRaw = field("trimId");
    const nextTrimId = trimIdRaw ? Number(trimIdRaw) : null;
    setNeeds(nextNeeds);
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("고객 니즈 수정 완료");
    // 상세 구매조건의 "구매방식"이 같은 need_method 컬럼이다 — detail을 갱신해야 그쪽 화면도 따라온다
    // (두 영역이 별도 훅 상태라, 이게 없으면 드로어를 다시 열어야 맞춰졌다).
    applyDetailPatch({
      needModel: nextNeeds.model || null,
      needTrim: nextNeeds.trim || null,
      needTrimId: nextTrimId,
      needColors: nextNeeds.colors || null,
      needMethod: nextNeeds.method || null,
      needMemo: nextNeeds.memo || null,
    });
    // 목록 "차종·구매방식" 열도 즉시(전체 재페치를 기다리지 않는다 — #354와 같은 결).
    onVehicleChange?.({ vehicle: nextNeeds.model, vehicleTrim: nextNeeds.trim || undefined, method: nextNeeds.method });
    savePatch(
      {
        needModel: nextNeeds.model || null,
        needTrim: nextNeeds.trim || null,
        needTrimId: nextTrimId,
        needColors: nextNeeds.colors || null,
        needMethod: nextNeeds.method || null,
        needMemo: nextNeeds.memo || null,
      },
      // 저장 실패 롤백 — 낙관 갱신한 detail·목록 행도 함께 되돌린다(폼 상태만 되돌리면 화면 세 곳이
      // 어긋난 채 남는다). detail은 클로저에 잡힌 저장 이전 값이다.
      () => {
        setNeeds(prevNeeds);
        applyDetailPatch({
          needModel: detail.needModel,
          needTrim: detail.needTrim,
          needTrimId: detail.needTrimId,
          needColors: detail.needColors,
          needMethod: detail.needMethod,
          needMemo: detail.needMemo,
        });
        onVehicleChange?.({
          vehicle: detail.needModel ?? "",
          vehicleTrim: detail.needTrim ?? undefined,
          method: detail.needMethod ?? "",
        });
      },
    );
  }

  // 대표 견적요청 지정(설계 D1) — 서버가 need_* 7필드를 그 요청 값으로 갱신하고 **결과를 응답에 실어
  // 준다**. 그 값으로 상세를 바로 갱신한다: 상세를 다시 받으면 prod에서 왕복이 2회가 되어 눈에 띄게
  // 느리다(로컬은 수십 ms라 안 보였다 — 2026-07-24 실기).
  // 낙관적 갱신(응답 전에 미리 그리기)은 하지 않는다 — 차종·트림이 catalog 조인 결과라 클라가 값을
  // 알 수 없고, 틀린 값을 그렸다가 되돌리면 깜빡인다.
  // 이미 대표인 카드를 다시 눌러도 그대로 보낸다 — 서버가 같은 값으로 덮어 결과가 같고(멱등),
  // 해제 개념이 없어(항상 1건) 토글 분기를 두면 "대표 없음" 상태가 생긴다.
  function featureRequest(requestId: string) {
    void featureQuoteRequest(detail.id, requestId)
      .then((result) => {
        applyDetailPatch({
          featuredRequestId: result.featuredRequestId,
          needModel: result.needModel,
          needTrim: result.needTrim,
          needMethod: result.needMethod,
          needContractTerm: result.needContractTerm,
          needInitialCost: result.needInitialCost,
          needAnnualMileage: result.needAnnualMileage,
          needTiming: result.needTiming,
        });
        // 목록 "차종·구매방식" 열도 같은 응답값으로 그 행만 즉시 고친다 — 전체 재페치를 기다리면
        // prod에서 왕복이 하나 더 붙어 목록만 뒤늦게 바뀐다(2026-07-24 실기).
        onVehicleChange?.({
          vehicle: result.needModel ?? "",
          vehicleTrim: result.needTrim ?? undefined,
          method: result.needMethod ?? "",
        });
        // 나머지 파생(lastActivity 등) 동기화 — 배경으로 흘린다. 도착해도 같은 값이라 깜빡이지 않는다.
        onCustomerListChanged?.();
        markRecentUpdate("고객 정보");
        onToast("대표 견적요청 변경 완료");
      })
      .catch(() => onToast("대표 견적요청을 바꾸지 못했습니다."));
  }

  return {
    needs,
    appRequests,
    consultations,
    reloadAppRequests,
    handlers: {
      saveNeeds,
      dismissConsultation: handleDismissConsultation,
      featureRequest,
    },
  };
}
