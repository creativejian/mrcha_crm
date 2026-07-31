import { useCallback, useEffect, useState } from "react";

import { getJson, sendJson } from "./http";
import { invalidateMyProposalTrims } from "./dealer-roster";

// 딜러 **본인**의 할인 제안(crm.dealer_trim_discounts) — MC 마스터 딜러 모드가 쓴다.
// ⚠️ 이 값은 **제안**이고 확정 할인이 아니다: catalog.trims의 3컬럼은 관리자 채택으로만 바뀐다
// (spec §2). 서버가 브랜드 소유권을 fail-closed로 검증하므로 타 브랜드 트림은 403이다.
// 다른 딜러의 제안은 서버가 내려주지 않는다(경쟁사 할인 전략 비노출 — spec §7.1).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §3.2·§7.1
export type DealerDiscountAmounts = {
  financialAmount: number | null;
  partnerAmount: number | null;
  cashAmount: number | null;
};

export type DealerDiscountProposal = DealerDiscountAmounts & { trimId: number; updatedAt: string };

// 이 모듈 밖에서 부를 일이 없어 export하지 않는다(소비처는 아래 훅 하나 — knip 기준선 0).
async function fetchMyDiscounts(modelId: number): Promise<DealerDiscountProposal[]> {
  return getJson<DealerDiscountProposal[]>(`/api/dealer/discounts?modelId=${modelId}`);
}

const toMap = (rows: DealerDiscountProposal[]) => new Map(rows.map((r) => [r.trimId, r]));

export function useDealerDiscounts(
  modelId: number | null,
  enabled: boolean,
): {
  byTrim: Map<number, DealerDiscountProposal>;
  save: (trimId: number, amounts: DealerDiscountAmounts) => Promise<void>;
} {
  const [byTrim, setByTrim] = useState<Map<number, DealerDiscountProposal>>(new Map());

  // ⚠️ setState는 **콜백 안에서** 부른다 — effect 본문에서 async 함수를 호출하면 그 함수가
  // setState를 하더라도 react-hooks/set-state-in-effect가 잡는다(기준선 0).
  // 실패는 빈 Map으로 흡수한다: 제안이 없는 상태와 같은 화면이 되고, 입력은 여전히 가능하다
  // (저장 실패는 셀이 자기 상태로 알린다 — 로드 실패를 크게 알릴 이유가 없다).
  useEffect(() => {
    if (!enabled || modelId == null) return;
    let alive = true;
    fetchMyDiscounts(modelId)
      .then((rows) => {
        if (alive) setByTrim(toMap(rows));
      })
      .catch(() => {
        if (alive) setByTrim(new Map());
      });
    return () => {
      alive = false;
    };
  }, [enabled, modelId]);

  // 저장 성공 시 **응답 row로 Map을 갱신**한다(재조회 왕복 없음).
  // 실패는 그대로 throw — 호출한 셀이 "저장 실패"를 표시해야 한다(삼키면 조용히 유실된다).
  // 응답 null = 세 금액을 다 비워 **서버가 행을 지웠다**(saveDealerTrimDiscount 계약) → Map에서도
  // 지운다. null을 그대로 set하면 이후 셀이 빈 객체를 제안으로 읽는다.
  const save = useCallback(async (trimId: number, amounts: DealerDiscountAmounts) => {
    const row = await sendJson<DealerDiscountProposal | null>(`/api/dealer/discounts/${trimId}`, "PUT", amounts);
    setByTrim((prev) => {
      const next = new Map(prev);
      if (row) next.set(trimId, row);
      else next.delete(trimId);
      return next;
    });
    invalidateMyProposalTrims(); // "내 입력 트림" 목록·건수가 낡는다(헤더 버튼 캐시)
  }, []);

  return { byTrim, save };
}
