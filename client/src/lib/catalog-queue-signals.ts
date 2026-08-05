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

// 계기 카운터(= 조회 "세대"). 아래 createQueueEpochFetch가 이 값으로 **같은 계기에서 출발한
// 조회끼리만** 합류시킨다. 밖으로 내보내지 않는다 — 노출하면 "지금 몇 세대냐"를 화면 로직이
// 읽고 분기하기 시작하고, 그건 신선도 판단이 다시 소비처로 흩어지는 길이다(이 모듈이 생긴 이유).
let queueEpoch = 0;

// ⚠️ 발신은 **리스너 예외를 격리**한다 — 알림 시점엔 원 작업(적재·승인·할당)이 이미 커밋된
// 뒤라, 여기서 던지면 성공한 작업이 호출부 catch에서 거짓 실패로 보이고 재시도는 409로 막히는
// 막다른 길이 된다(구 sendCatalogWrite의 규약을 세 채널로 넓혔다).
function emit(listeners: Set<() => void>) {
  queueEpoch += 1; // 계기 1회 = 세대 1증가. focus·폴링은 여기를 거치지 않는다(아래 주석 참조).
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

// ③ broadcast는 **이 모듈이 한 번만** 구독하고 여기서 되뿌린다(2026-08-05). 훅 인스턴스가 각자
// 직접 구독하면 타 세션 신호 한 번에 emit이 인스턴스 수만큼 돌아 세대가 그만큼 뛰고, 같은 계기로
// 출발한 조회들이 서로 다른 세대로 갈려 in-flight 공유가 깨진다(요청 수가 도로 원위치).
// 부수 효과로 채널 구독도 1개로 고정된다 — realtime 매니저의 개설/해체 churn이 준다.
const remoteListeners = new Set<() => void>();
let remoteOff: (() => void) | null = null;
function onQueueRemoteChanged(listener: () => void): () => void {
  remoteListeners.add(listener);
  remoteOff ??= onCatalogQueueRemoteChanged(() => emit(remoteListeners));
  return () => {
    remoteListeners.delete(listener);
    if (remoteListeners.size > 0) return;
    remoteOff?.();
    remoteOff = null;
  };
}

// ── 겹친 조회 합치기 ─────────────────────────────────────────────────────────

/**
 * 같은 계기로 출발한 조회를 **한 요청으로 합친다**(2026-08-05). 큐 신호는 전역 pub/sub이라
 * 소비처 전원이 같은 순간 재조회에 들어가는데, 그때까지는 인스턴스마다 각자 왕복해 같은 URL이
 * 두 번씩 나가고 **두 응답 사이의 순간 불일치**(숫자가 1~2초 어긋남)가 배지에 그대로 보였다.
 *
 * ⚠️ 무조건 합치지 않고 **세대(epoch)가 같을 때만** 합류시킨다 — 승인 왕복 직전에 출발한 조회에
 * 승인 직후의 재조회가 올라타면 **승인 전 숫자**를 받아 배지가 조용히 stale이 된다(고치려는 결함의
 * 새 변종). 계기(적재·결정·타 세션 broadcast)가 세대를 올리므로 그런 합류는 자동으로 막힌다.
 * 반대로 focus 재검증·주기 폴링은 세대를 올리지 않는다 — "혹시 놓친 게 있나" 확인이라 진행 중인
 * 조회에 올라타도 무해하고, 오히려 합쳐지는 편이 맞다.
 */
export function createQueueEpochFetch<T>(run: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  let inflightEpoch = -1;
  return () => {
    if (inflight != null && inflightEpoch === queueEpoch) return inflight;
    const started: Promise<T> = run().finally(() => {
      if (inflight === started) inflight = null;
    });
    inflight = started;
    inflightEpoch = queueEpoch;
    return started;
  };
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
    const offs = [onCatalogWriteQueued(bump), onQueueRemoteChanged(bump)];
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
