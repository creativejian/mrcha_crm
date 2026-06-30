import { useEffect, useState, type Dispatch, type SetStateAction, type SyntheticEvent } from "react";

import { type CustomerDetailData, type CustomerWritePatch } from "@/lib/customers";
import { fetchCustomerQuoteRequests, type AppQuoteRequest } from "@/lib/quote-requests";

import { KIM_NEEDS_COLOR_PLACEHOLDER, type KimNeedsState } from "../needs-meta";
import { type OpenEditorState } from "../types";

type UseCustomerNeedsArgs = {
  detail: CustomerDetailData; // needs 초기값 매핑 소스 + appUserId(앱 카드 목록 fetch 여부) + id(앱 견적요청 fetch 키)
  onToast: (message: string) => void;
  // 부모 소유 공유 인프라(상태·구매조건도 사용). 훅은 인자로만 받아 쓴다.
  savePatch: (patch: CustomerWritePatch, rollback: () => void) => void;
  markRecentUpdate: (section: string) => void;
  setOpenEditor: Dispatch<SetStateAction<OpenEditorState | null>>;
};

export function useCustomerNeeds({
  detail,
  onToast,
  savePatch,
  markRecentUpdate,
  setOpenEditor,
}: UseCustomerNeedsArgs) {
  const [needs, setNeeds] = useState<KimNeedsState>(() => ({
    model: detail.needModel ?? "",
    trim: detail.needTrim ?? "",
    colors: detail.needColors ?? KIM_NEEDS_COLOR_PLACEHOLDER,
    method: detail.needMethod ?? "",
    memo: detail.needMemo ?? "",
  }));
  // 앱 유입 고객(detail.appUserId)이면 그 고객의 앱 견적요청 카드 목록. 수기 고객은 null → 기존 단일 need 카드.
  const [appRequests, setAppRequests] = useState<AppQuoteRequest[] | null>(null);

  // detail.appUserId 있으면 그 고객 요청 fetch(카드 목록). 없으면 null 유지(폴백 단일 카드).
  useEffect(() => {
    if (!detail.appUserId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 앱 고객 아니면 카드 목록 비움(외부 값 동기화)
      setAppRequests(null);
      return;
    }
    let cancelled = false;
    void fetchCustomerQuoteRequests(detail.id)
      .then((r) => { if (!cancelled) setAppRequests(r); })
      .catch(() => { if (!cancelled) setAppRequests([]); });
    return () => { cancelled = true; };
  }, [detail.appUserId, detail.id]);

  // 견적 승격 성공 후 배지(견적 N건) 갱신용 재fetch. 앱 고객일 때만 의미.
  // 워크벤치(Task 9 미추출, 부모 보유)가 견적 INSERT 성공 시 호출 → 훅이 반환하면 부모가 needs.reloadAppRequests()로 중계.
  function reloadAppRequests() {
    if (!detail.appUserId) return;
    void fetchCustomerQuoteRequests(detail.id).then(setAppRequests).catch(() => undefined);
  }

  function saveNeeds(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const prevNeeds = needs;
    const nextNeeds = {
      model: String(formData.get("model") ?? "").trim() || needs.model,
      trim: String(formData.get("trim") ?? "").trim() || needs.trim,
      colors: String(formData.get("colors") ?? "").trim() || needs.colors,
      method: String(formData.get("method") ?? "").trim() || needs.method,
      memo: String(formData.get("memo") ?? "").trim() || needs.memo,
    };
    setNeeds(nextNeeds);
    setOpenEditor(null);
    markRecentUpdate("고객 정보");
    onToast("고객 니즈 수정 완료");
    savePatch(
      { needModel: nextNeeds.model, needTrim: nextNeeds.trim, needColors: nextNeeds.colors, needMethod: nextNeeds.method, needMemo: nextNeeds.memo },
      () => setNeeds(prevNeeds),
    );
  }

  return {
    needs,
    appRequests,
    reloadAppRequests,
    handlers: {
      saveNeeds,
    },
  };
}
