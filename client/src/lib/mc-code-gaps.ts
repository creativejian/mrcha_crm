import { useEffect, useState } from "react";

import { createQueueEpochFetch, useCatalogQueueTick } from "./catalog-queue-signals";
import { getJson } from "./http";

// 고유번호(mc_code) 미부여 집계 — 브랜드 목록·모델 목록의 **파란 배지** 재료(2026-08-05).
// 빨간 배지(승인 대기)와 축이 다르다: 저쪽은 "결재할 것", 이쪽은 "결재 뒤에 남는 마무리"다.
//
// ⚠️ 이 집계는 **양방향으로 움직인다** — 승인(trim.create)하면 mc_code 없는 트림이 생겨 **늘고**,
// 고유번호를 할당하면 **준다**. 그래서 큐 신호(적재·결정·타 세션)에 할당 신호까지 함께 듣는다.
// 구독 목록 자체는 catalog-queue-signals가 SSOT다 — 계기를 더할 일이 생기면 거기서 한다.
// (알림 발신 notifyMcCodesAssigned도 그 모듈 소유다: 발신자가 lib/catalog 쪽이라 여기 두면 순환.)

export type McCodeGaps = {
  /** 브랜드 id → 그 브랜드 전체 모델의 미부여 합 */
  byBrand: Record<number, number>;
  /** 모델 id → 그 모델의 미부여 수 */
  byModel: Record<number, number>;
};

const EMPTY: McCodeGaps = { byBrand: {}, byModel: {} };

// 소비처가 둘이다(사이드바 총계 · MC 마스터 목록 배지). 둘 다 같은 신호에 반응하므로 재조회
// 시점이 겹치는데, 각자 왕복하면 같은 URL이 두 번 나가고 두 응답 사이에 배지가 어긋난다 —
// 계기 단위로 한 요청에 합친다(catalog-queue-signals). 여기는 대기열과 달리 스냅샷 방송이 없어도
// 된다: 소비처 둘 다 폴링·focus 축이 없어 **갱신 계기가 항상 공유 신호**라, 합쳐진 한 응답을
// 양쪽이 그대로 받는다. 폴링을 켜는 소비처가 생기면 그때는 대기열처럼 스냅샷을 공유해야 한다.
const fetchMcCodeGaps = createQueueEpochFetch(() => getJson<McCodeGaps>("/api/catalog/models/mc-code-gaps"));

/**
 * 미부여 집계 구독. `enabled`는 **부여 권한과 같은 축**(admin)이어야 한다 — 처리할 수 없는
 * 역할에 밀린 일 숫자만 보이면 읽는 사람이 할 수 있는 게 없다(서버도 같은 게이트로 닫혀 있다).
 * 조회 실패는 무소음 폴백(직전 값 유지) — 배지는 최선 노력이고, 실패가 화면을 막아선 안 된다.
 */
export function useMcCodeGaps(enabled: boolean): McCodeGaps {
  const [gaps, setGaps] = useState<McCodeGaps>(EMPTY);
  const tick = useCatalogQueueTick(enabled, { assigned: true });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchMcCodeGaps()
      .then((next) => {
        if (alive) setGaps(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, tick]);

  return gaps;
}
