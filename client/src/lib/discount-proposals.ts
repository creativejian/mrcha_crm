import { useCallback, useEffect, useState } from "react";

import type { DiscountField, ProposalState } from "./discount-adoption";
import { getJson, sendJson } from "./http";

// 관리자용 딜러 제안 조회·채택(슬라이스 C) — MC 마스터 관리자 모드의 할인 셀 팝오버가 쓴다.
// **admin 전용 API**다(서버 requireRoles(["admin"])): staff가 남의 딜러 제안을 열람하거나
// 확정 할인을 채택할 수 없고, 딜러는 GET조차 막힌다(경쟁사 할인 전략 비노출).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §7.2
// 아래 세 타입은 TrimProposals의 구성 요소일 뿐이라 export하지 않는다(같은 파일에서만 쓰는
// export는 knip 기준선 0을 깨뜨린다 — #333 선례). 소비자는 TrimProposals를 통해 닿는다.
type TrimProposalField = { amount: number | null; state: ProposalState };

type TrimProposalRow = {
  dealerUserId: string;
  dealerName: string | null;
  /** 딜러사명("동성모터스") — 관리자가 조직 화면에서 입력한 비고. */
  dealerNote: string | null;
  /** false = 자격 상실(딜러를 그만둠) → 채택 불가. 서버도 같은 기준으로 거부한다. */
  isDealer: boolean;
  financial: TrimProposalField;
  partner: TrimProposalField;
  cash: TrimProposalField;
  updatedAt: string;
};

type TrimAdoptedField = {
  amount: number | null;
  /** null = 관리자 직접 입력이거나 채택 이력이 없다. */
  sourceDealerUserId: string | null;
  adoptedAt: string | null;
};

export type TrimProposals = {
  trimId: number;
  adopted: Record<DiscountField, TrimAdoptedField>;
  proposals: TrimProposalRow[];
};

// 이 모듈 밖에서 부를 일이 없어 export하지 않는다(소비처는 아래 훅 하나 — knip 기준선 0).
async function fetchProposals(modelId: number): Promise<TrimProposals[]> {
  return getJson<TrimProposals[]>(`/api/catalog/models/${modelId}/discount-proposals`);
}

const toMap = (rows: TrimProposals[]) => new Map(rows.map((r) => [r.trimId, r]));

export function useTrimProposals(
  modelId: number | null,
  enabled: boolean,
): {
  byTrim: Map<number, TrimProposals>;
  adopt: (trimId: number, field: DiscountField, dealerUserId: string) => Promise<void>;
} {
  const [byTrim, setByTrim] = useState<Map<number, TrimProposals>>(new Map());

  // ⚠️ setState는 **콜백 안에서** 부른다 — effect 본문에서 async 함수를 호출하면 그 함수가
  // setState를 하더라도 react-hooks/set-state-in-effect가 잡는다(기준선 0).
  // 실패는 빈 Map으로 흡수한다: 제안이 0건인 상태와 같은 화면이 되고(셀에 단서가 없다),
  // 관리자의 기존 편집 경로(TrimEditPanel)는 그대로 살아 있다.
  useEffect(() => {
    if (!enabled || modelId == null) return;
    let alive = true;
    fetchProposals(modelId)
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

  // 채택 후에는 **목록 전체를 다시 받는다**(응답 row로 갈아끼우지 않는다) — 한 필드를 채택하면
  // 같은 트림의 다른 딜러 제안 상태까지 바뀌기 때문이다(그 딜러들은 "미채택"이 된다).
  // 실패는 그대로 throw — 호출한 팝오버가 알려야 한다(삼키면 조용히 유실된다).
  // ⚠️ 확정 할인 셀(트림 목록)은 이 훅의 소관이 아니다 — 호출자가 reloadTrims()로 다시 읽는다.
  const adopt = useCallback(
    async (trimId: number, field: DiscountField, dealerUserId: string) => {
      await sendJson(`/api/catalog/trims/${trimId}/discount-adoptions`, "POST", { field, dealerUserId });
      if (modelId != null) setByTrim(toMap(await fetchProposals(modelId)));
    },
    [modelId],
  );

  return { byTrim, adopt };
}
