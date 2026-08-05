import { useEffect, useState } from "react";

import { onChangeRequestQueueUpdated } from "./catalog-change-requests";
import { getJson } from "./http";

// 고유번호(mc_code) 미부여 집계 — 브랜드 목록·모델 목록의 **파란 배지** 재료(2026-08-05).
// 빨간 배지(승인 대기)와 축이 다르다: 저쪽은 "결재할 것", 이쪽은 "결재 뒤에 남는 마무리"다.
//
// ⚠️ 갱신 신호가 **두 방향**이다 — 이 훅이 둘 다 구독해야 화면이 진실을 말한다.
//   ① 승인(trim.create) → 트림이 생기는데 mc_code는 없다(auto_mc_code가 BEFORE UPDATE 전용)
//      → 미부여가 **늘어난다**. 그래서 큐 알림(onChangeRequestQueueUpdated)도 듣는다.
//   ② 고유번호 할당 → UPDATE가 돌아 mc_code가 생긴다 → 미부여가 **준다**(아래 notify).
// 승인 한 번에 빨강이 줄고 파랑이 느는 게 같은 순간에 보여야 한다.
//
// 알림을 이 파일이 소유하는 이유: 발신자는 `assignMcCodes`(lib/catalog)인데 그쪽이 이 모듈을
// import하면 순환이 된다 — 호출부(MC 마스터 화면)가 성공 직후 notify를 부른다.

export type McCodeGaps = {
  /** 브랜드 id → 그 브랜드 전체 모델의 미부여 합 */
  byBrand: Record<number, number>;
  /** 모델 id → 그 모델의 미부여 수 */
  byModel: Record<number, number>;
};

const EMPTY: McCodeGaps = { byBrand: {}, byModel: {} };

const assignedListeners = new Set<() => void>();

/** 고유번호 할당 성공을 같은 탭에 알린다 — 브랜드·모델 파란 배지가 리로딩 없이 줄어든다. */
export function notifyMcCodesAssigned() {
  for (const listener of assignedListeners) listener();
}

function onMcCodesAssigned(listener: () => void): () => void {
  assignedListeners.add(listener);
  return () => {
    assignedListeners.delete(listener);
  };
}

async function fetchMcCodeGaps(): Promise<McCodeGaps> {
  return getJson<McCodeGaps>("/api/catalog/models/mc-code-gaps");
}

/**
 * 미부여 집계 구독. `enabled`는 **부여 권한과 같은 축**(admin)이어야 한다 — 처리할 수 없는
 * 역할에 밀린 일 숫자만 보이면 읽는 사람이 할 수 있는 게 없다(서버도 같은 게이트로 닫혀 있다).
 * 조회 실패는 무소음 폴백(빈 집계) — 배지는 최선 노력이고, 실패가 화면을 막아선 안 된다.
 */
export function useMcCodeGaps(enabled: boolean): McCodeGaps {
  const [gaps, setGaps] = useState<McCodeGaps>(EMPTY);
  const [tick, setTick] = useState(0);

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

  // ① 승인으로 트림이 생기면 미부여가 는다(위 주석 참조).
  useEffect(() => (enabled ? onChangeRequestQueueUpdated(() => setTick((t) => t + 1)) : undefined), [enabled]);
  // ② 할당하면 준다.
  useEffect(() => (enabled ? onMcCodesAssigned(() => setTick((t) => t + 1)) : undefined), [enabled]);

  return gaps;
}
