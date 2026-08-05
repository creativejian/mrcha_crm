import { useEffect, useState } from "react";

import { onCatalogQueueRemoteChanged } from "./catalog-change-realtime";

// 카탈로그 변경 큐가 "움직였을 수 있는" 계기들의 **SSOT**(2026-08-05).
//
// 왜 모았나: 계기가 넷인데 소비처마다 **다른 조합**을 골라 듣고 있었고, 어느 조합이 맞는지가
// 어디에도 적혀 있지 않았다. 그 결과 같은 화면의 배지 셋이 서로 다른 숫자를 보여줬다 —
//   · 사이드바 배지는 "줄어드는 사건"만 들어서 새 요청이 쌓이면 최대 60초 뒤처졌다
//   · 고유번호 미부여 배지는 **타 세션** 승인을 못 받았다(모듈 pub/sub은 탭 안에서만 돈다)
// 둘 다 조용히 어긋나는 종류라 눈으로만 발견됐다. 이제 소비처는 이 훅 하나만 쓰고, 계기를
// 추가할 일이 생기면 **이 파일만** 고친다.
//
// 계기 넷:
//   ① 적재(202)          — 팀장 쓰기가 큐로 들어감. 큐가 **는다**.
//   ② 결정(승인·반려·취소) — 큐가 **준다**. 승인은 동시에 mc_code 없는 트림을 만든다.
//   ③ broadcast          — **다른 세션**의 ①②. 모듈 pub/sub이 못 넘는 경계를 채널이 넘긴다.
//   ④ 고유번호 할당       — 큐와 무관하지만 미부여 집계를 줄인다(그 소비처만 켠다).
// 그물 둘(옵션): 창 focus 재검증 · 주기 폴링. broadcast가 못 닿는 구간(채널 미가입 사이·
// 전송 유실)을 메운다.

// ── 계기별 pub/sub ───────────────────────────────────────────────────────────
// ⚠️ 정의를 여기 모은 이유는 순환 import 회피이기도 하다 — 소비 훅(catalog-change-requests 등)이
// 이 모듈을 쓰는데, 정의가 그쪽에 남아 있으면 서로를 import하게 된다. 발신자는 각자 여기서
// notify만 가져다 쓴다.

// ⚠️ 발신은 **리스너 예외를 격리**한다 — 알림 시점엔 원 작업(적재·승인·할당)이 이미 커밋된
// 뒤라, 여기서 던지면 성공한 작업이 호출부 catch에서 거짓 실패로 보이고 재시도는 409로 막히는
// 막다른 길이 된다(구 sendCatalogWrite의 규약을 세 채널로 넓혔다).
function emit(listeners: Set<() => void>) {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // 알림은 부가 효과 — 실패해도 원 작업 결과에 영향을 주지 않는다.
    }
  }
}

const writeQueuedListeners = new Set<() => void>();
/** ① 적재(202) 구독. */
export function onCatalogWriteQueued(listener: () => void): () => void {
  writeQueuedListeners.add(listener);
  return () => {
    writeQueuedListeners.delete(listener);
  };
}
/** 발신자 = lib/catalog의 쓰기 래퍼(sendCatalogWrite). */
export function notifyCatalogWriteQueued() {
  emit(writeQueuedListeners);
}

const decisionListeners = new Set<() => void>();
/** ② 결정(승인·반려·취소) 구독 — 아래 useCatalogQueueTick 전용(직접 구독처는 없다). */
function onChangeRequestQueueUpdated(listener: () => void): () => void {
  decisionListeners.add(listener);
  return () => {
    decisionListeners.delete(listener);
  };
}
/** 발신자 = 승인·반려·취소 헬퍼(catalog-change-requests). */
export function notifyQueueUpdated() {
  emit(decisionListeners);
}

const assignedListeners = new Set<() => void>();
/** ④ 고유번호 할당 구독 — 위와 같이 훅 전용. */
function onMcCodesAssigned(listener: () => void): () => void {
  assignedListeners.add(listener);
  return () => {
    assignedListeners.delete(listener);
  };
}
/** 발신자 = MC 마스터 화면의 할당 핸들러(성공 직후). */
export function notifyMcCodesAssigned() {
  emit(assignedListeners);
}

// ── 구독 SSOT ────────────────────────────────────────────────────────────────

type QueueTickOptions = {
  /**
   * ② 결정을 들을지. 기본 true.
   * false는 팀장 "내 요청" 하나뿐이다 — 같은 탭의 승인/반려는 admin 화면 이벤트라 세션이 겹치지
   * 않고, 내 취소는 그 훅이 직접 tick을 올린다. **타 세션의** 결정은 ③이 실어 나른다.
   */
  decisions?: boolean;
  /** ④ 고유번호 할당을 들을지. 기본 false — 미부여 집계만 쓴다. */
  assigned?: boolean;
  /** 창 포커스 복귀 시 재검증(broadcast 유실 그물). 기본 false. */
  focus?: boolean;
  /** 주기 폴링(ms). 기본 없음 — 신호가 닿지 않는 화면에서만 켠다. */
  pollMs?: number;
};

/**
 * 큐 신선도 tick — 값이 바뀌면 소비처가 다시 조회한다(조회 deps에 넣기만 하면 된다).
 * ①②③은 **항상** 듣는다: 셋 다 "큐가 움직였다"는 같은 뜻이고, 일부만 골라 듣는 것이 지금까지
 * 어긋남의 원인이었다. 다르게 가져가야 할 축만 옵션으로 열어 둔다.
 */
export function useCatalogQueueTick(enabled: boolean, opts: QueueTickOptions = {}): number {
  const { decisions = true, assigned = false, focus = false, pollMs } = opts;
  const [tick, setTick] = useState(0);

  // 콜백을 매번 새로 만들지 않으려 인라인 대신 한 번만 정의한다(구독/해제 churn 방지).
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setTick((t) => t + 1);
    const offs = [onCatalogWriteQueued(bump), onCatalogQueueRemoteChanged(bump)];
    if (decisions) offs.push(onChangeRequestQueueUpdated(bump));
    if (assigned) offs.push(onMcCodesAssigned(bump));
    if (focus) {
      window.addEventListener("focus", bump);
      offs.push(() => window.removeEventListener("focus", bump));
    }
    if (pollMs != null) {
      const timer = window.setInterval(bump, pollMs);
      offs.push(() => window.clearInterval(timer));
    }
    return () => {
      for (const off of offs) off();
    };
  }, [enabled, decisions, assigned, focus, pollMs]);

  return tick;
}
