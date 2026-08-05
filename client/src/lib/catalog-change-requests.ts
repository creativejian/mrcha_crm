import { useCallback, useEffect, useState } from "react";

import { mcMasterPath } from "@/pages/mc-master/mc-master-route";

import { CHANGE_FIELD_LABELS, OPTION_TYPE_VALUE_LABELS, type ChangeRequestKind } from "./catalog-change-kinds";
import { broadcastCatalogQueueChanged } from "./catalog-change-realtime";
import { createQueueEpochFetch, notifyQueueUpdated, useCatalogQueueTick } from "./catalog-queue-signals";
import { getJson, sendJson } from "./http";

// MC 마스터 변경 승인 대기열 — admin 대기열 팝오버(ChangeRequestQueue) + manager 행 배지·내 요청
// 팝오버가 소비한다.
// spec: ref/specs/2026-07-30-crm-catalog-change-approval-design.md §6.3
// 조회 실패는 failed로만 알리고(무소음 폴백 — discount-proposals.ts 관례), 승인/반려 실패는
// throw한다(삼키면 조용히 유실 — 호출한 팝오버가 행별 에러로 표시해야 한다).
export type ChangeRequestItem = {
  id: string;
  kind: ChangeRequestKind;
  targetType: string;
  targetId: number | null;
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
  status: string;
  requestedBy: string;
  rejectReason: string | null;
  createdAt: string;
  decidedAt: string | null; // 승인/반려 시각 — "내 요청" 자동 소멸 창의 기준(filterMyRequestVisible)
  targetLabel: string;
  targetBrandId: number | null;
  targetModelId: number | null;
  targetTrimId: number | null;
};

const QUEUE_URL = "/api/catalog/change-requests?status=pending";

// 대기열 응답은 **모듈 한 벌**이다(2026-08-05). 두 몫을 겸한다:
//  ① 마지막 응답 캐시(dealer-roster getCachedMyProposalTrims 선례) — 헤더 버튼 (N)이 재마운트
//     직후(메뉴 이동·모델 전환 재진입) 숫자 없는 라벨로 깜빡이지 않게 직전 값을 즉시 보여준다.
//     브라우저 새로고침(F5)은 모듈이 초기화되므로 여전히 첫 fetch 후에 뜬다 — 세션 스토리지
//     영속화는 stale 위험 대비 과함.
//  ② 소비처 공통 상태 — 이 훅은 **인스턴스가 여럿**이다(사이드바 배지 · 모델/브랜드 목록 배지 ·
//     헤더 대기열 팝오버). 인스턴스마다 자기 state를 들고 있으면 한쪽만 갱신되는 순간(폴링·마운트
//     시점 차이)에 같은 화면의 배지가 서로 다른 숫자를 보인다 — 이 축에서 세 번 반복된 결함이다.
//     이제 조회 결과는 여기 한 곳에 실리고, 훅은 그걸 구독만 한다.
type QueueSnapshot = { rows: ChangeRequestItem[] | null; failed: boolean };
let queueSnapshot: QueueSnapshot = { rows: null, failed: false };
const queueSnapshotListeners = new Set<() => void>();
let mineCache: ChangeRequestItem[] | null = null;

function publishQueueSnapshot(next: QueueSnapshot): void {
  queueSnapshot = next;
  for (const listener of queueSnapshotListeners) {
    try {
      listener();
    } catch {
      // 구독자 예외 격리 — catalog-queue-signals emit과 같은 규약(한 화면의 렌더 실패가 다른
      // 화면의 갱신을 막지 않는다).
    }
  }
}

// 조회는 이 함수 하나만 거친다 — 같은 계기로 출발한 소비처들이 한 요청으로 합쳐지고(중복 제거),
// 도착한 응답은 **모두가 같은 값**으로 본다. 실패는 직전 rows를 유지한 채 failed만 세운다
// (stale 숫자가 빈 화면보다 낫다 — useModelPendingRequests와 같은 판단).
//
// ⚠️ **최신 요청의 응답만 반영한다**(queueSeq). 요청이 둘 동시에 떠 있는 경우는 세대가 갈릴 때뿐인데
// (같은 세대는 위에서 합쳐진다), 그게 하필 "승인 직전에 출발한 조회 + 승인 직후 재조회"다. 늦게
// 도착한 옛 응답이 그대로 실리면 배지가 승인 전 숫자로 되돌아간다 — 인스턴스별 state 시절 effect
// cleanup(alive=false)이 막던 몫이라, 상태를 모듈로 올리면서 함께 옮겨 온다.
let queueSeq = 0;
const revalidateQueue = createQueueEpochFetch(() => {
  const seq = ++queueSeq;
  return getJson<ChangeRequestItem[]>(QUEUE_URL).then(
    (rows) => {
      if (seq === queueSeq) publishQueueSnapshot({ rows, failed: false });
    },
    () => {
      if (seq === queueSeq) publishQueueSnapshot({ rows: queueSnapshot.rows, failed: true });
    },
  );
});

// 테스트 전용 — 모듈 캐시 초기화(케이스 간 오염 방지, resetStaffDirectoryCache 관례).
export function resetChangeRequestCachesForTest(): void {
  queueSnapshot = { rows: null, failed: false };
  mineCache = null;
}

// 대기열 변동 알림 채널은 catalog-queue-signals가 소유한다(2026-08-05 SSOT) — 여기서는 발신만 한다.

/**
 * 관리자 승인 대기열 구독. `opts`는 **이 소비처만의 신선도 사정**을 넘기는 자리다 — 상시 마운트인
 * 사이드바가 focus 재검증·주기 폴링을 소유하고(그 결과는 위 모듈 스냅샷을 통해 전 인스턴스에
 * 퍼진다), 화면 안 배지는 신호만으로 충분해 옵션 없이 쓴다. 계기 목록 자체는 catalog-queue-signals가 SSOT.
 */
export function useChangeRequestQueue(
  enabled: boolean,
  opts: { focus?: boolean; pollMs?: number } = {},
): {
  rows: ChangeRequestItem[] | null; // null = 미로드/로딩
  failed: boolean;
  reload: () => void;
  approve: (id: string) => Promise<void>;
  reject: (id: string, reason: string) => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(queueSnapshot);
  const [tick, setTick] = useState(0);
  // 큐가 움직였을 수 있는 모든 계기(적재·결정·타 세션) — 구독 목록은 catalog-queue-signals가 SSOT.
  // ⚠️ 이 훅은 **인스턴스가 여럿**이다(사이드바 배지 · 헤더 팝오버 · 모델 목록 배지). 아래
  // approve/reject의 tick은 자기 인스턴스만 갱신하므로, 이 신호가 없으면 팝오버에서 승인해도
  // 배지가 리로딩 전까지 그대로다(#454 도입 직후 실기 발견 — 그전까진 인스턴스가 하나뿐이라
  // 드러나지 않았다).
  const signalTick = useCatalogQueueTick(enabled, opts);

  // 모듈 스냅샷 구독 — 어느 인스턴스가 받아온 응답이든 전원이 같은 값으로 따라간다.
  useEffect(() => {
    if (!enabled) return;
    const listener = () => setSnapshot(queueSnapshot);
    queueSnapshotListeners.add(listener);
    return () => {
      queueSnapshotListeners.delete(listener);
    };
  }, [enabled]);

  // ⚠️ setState는 **콜백 안에서** 부른다(react-hooks/set-state-in-effect 기준선 0 — discount-proposals.ts 관례).
  // 여기서는 재조회를 걸기만 한다 — 결과 반영은 위 구독이 맡으므로 alive 가드가 필요 없다.
  useEffect(() => {
    if (!enabled) return;
    void revalidateQueue();
  }, [enabled, tick, signalTick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // 성공 시에만 재조회 — 실패(409 드리프트 등)는 throw로 올라가 호출한 팝오버가 행별로 표시한다.
  // broadcast는 상대 세션(팀장 배지·내 요청) 몫 — 내 화면은 tick·notify가 즉시 갱신한다.
  const approve = useCallback(async (id: string) => {
    await approveChangeRequestById(id);
    setTick((t) => t + 1);
  }, []);

  const reject = useCallback(async (id: string, reason: string) => {
    await rejectChangeRequestById(id, reason);
    setTick((t) => t + 1);
  }, []);

  // enabled:false는 **조회를 안 하는 상태**이므로 캐시가 남아 있어도 미로드로 보인다 —
  // 권한이 없어 못 받는 화면이 남은 숫자를 계속 말하면 안 된다(useMyChangeRequests와 같은 규칙).
  return {
    rows: enabled ? snapshot.rows : null,
    failed: enabled ? snapshot.failed : false,
    reload,
    approve,
    reject,
  };
}

// 승인/반려 단독 헬퍼(2026-08-03) — 헤더 대기열 팝오버(위 훅)와 행 배지 팝오버
// (PendingRequestBadge)가 같은 전파 규약을 공유한다: 성공 시 같은 탭 구독자
// (notifyQueueUpdated — 모델 배지·사이드바)와 타 세션(broadcast)에 알린다.
// 실패는 throw — 호출한 팝오버가 행별 에러로 표시한다(삼키면 조용히 유실).
export async function approveChangeRequestById(id: string): Promise<void> {
  await sendJson(`/api/catalog/change-requests/${id}/approve`, "POST");
  notifyQueueUpdated();
  // applied=true — 승인만 catalog를 바꾼다. 상대 세션은 이 플래그로 카탈로그 재조회까지 한다.
  broadcastCatalogQueueChanged({ applied: true });
}

export async function rejectChangeRequestById(id: string, reason: string): Promise<void> {
  await sendJson(`/api/catalog/change-requests/${id}/reject`, "POST", { reason });
  notifyQueueUpdated(); // 반려도 pending 카운트가 줄어드므로 승인과 동일하게 알린다.
  broadcastCatalogQueueChanged();
}

export type ChangeDiffLine = { label: string; before: string | null; after: string };

// 전→후 diff 합성(순수) — 서버 스냅샷 규약(spec §5.1)에 기댄다: update kind의 snapshot은
// payload가 건드리는 필드의 요청 시점 값(같은 키 집합), create는 부모 존재 확인({})이라 전 값 없음.
// 부모 id류(brandId/modelId/trimId)는 diff에서 제외 — targetLabel이 이미 대상을 말한다.
const PARENT_ID_KEYS = new Set(["brandId", "modelId", "trimId"]);

// 연식은 콤마 없이 표기한다(2,024는 한국어 관례상 오표기). 나머지 숫자(가격·할인·배기량)는
// 천단위 콤마가 자연스럽다. boolean/객체 값은 현행 8종 스키마에 없다 — 새 kind/필드 추가 시
// formatValue 분기를 함께 챙길 것(String(true) = "true" 영문 노출).
const COMMA_EXEMPT_KEYS = new Set(["modelYear"]);

function formatValue(v: unknown, key: string): string | null {
  if (v == null) return null;
  if (key === "type") return OPTION_TYPE_VALUE_LABELS[String(v)] ?? String(v); // OptionPanel 화면 어휘(basic/tuning 원문 폴백)
  if (typeof v === "number") return COMMA_EXEMPT_KEYS.has(key) ? String(v) : v.toLocaleString("ko-KR");
  return String(v);
}

export function buildChangeDiff(row: Pick<ChangeRequestItem, "kind" | "payload" | "snapshot">): ChangeDiffLine[] {
  if (row.kind === "trim.no-option.set" || row.kind === "trim.no-option.unset") {
    return []; // kind 라벨("무옵션 확정/해제")이 이미 전부다 — 필드 diff 없음
  }
  const isCreate = row.kind.endsWith(".create");
  const snapshot = row.snapshot ?? {};
  const keys = Object.keys(row.payload).filter((k) => !PARENT_ID_KEYS.has(k));
  // update는 미변경 줄을 걸러낸다 — 팀장 폼이 13필드 전체를 전송하므로 안 거르면 diff가
  // "같은 값 → 같은 값"으로 도배돼 승인자가 바뀐 줄을 눈으로 찾아야 한다.
  const changedKeys = isCreate ? keys : keys.filter((k) => (snapshot[k] ?? null) !== (row.payload[k] ?? null));
  return changedKeys.map((k) => ({
    label: CHANGE_FIELD_LABELS[k] ?? k,
    before: isCreate ? null : formatValue(snapshot[k], k),
    after: formatValue(row.payload[k], k) ?? "—",
  }));
}

// "내 요청" 자동 소멸(순수, 2026-07-31 유슨생 — spec §7.3 "최근 approved" 의도의 실현):
// 아무도 지우지 않아도 팝오버가 "지금 볼 것"만 보여준다.
//  - pending: 항상(행동 대상)
//  - rejected: 같은 대상+작업의 재요청(pending)이 생기면 즉시 숨김(반려 확인→수정→재요청 루프
//    완료 = 용무 끝) · 재요청 없어도 반려 7일 뒤 소멸. create류(targetId null)는 재요청 매칭이
//    불가능해(새 행도 null) 7일 창만 적용된다.
//  - approved: 24시간만(반영 확인 용도 — 결과는 카탈로그 화면이 이미 보여준다)
//  - canceled: 항상 숨김(기존 규칙 이관)
// 창 기준은 decidedAt(승인/반려 시각), 방어 폴백 createdAt. 행 데이터는 남는다(감사 기록) —
// 이건 표시 필터일 뿐이다.
const MY_REJECTED_WINDOW_MS = 7 * 24 * 3_600_000;
const MY_APPROVED_WINDOW_MS = 24 * 3_600_000;

export function filterMyRequestVisible<
  T extends Pick<ChangeRequestItem, "status" | "kind" | "targetId" | "createdAt" | "decidedAt">,
>(rows: T[], now: Date): T[] {
  const pendingKeys = new Set(
    rows.filter((r) => r.status === "pending" && r.targetId != null).map((r) => `${r.kind}:${r.targetId}`),
  );
  const decidedAgo = (r: T) => now.getTime() - Date.parse(r.decidedAt ?? r.createdAt);
  return rows.filter((r) => {
    if (r.status === "pending") return true;
    if (r.status === "rejected") {
      if (r.targetId != null && pendingKeys.has(`${r.kind}:${r.targetId}`)) return false;
      return decidedAgo(r) < MY_REJECTED_WINDOW_MS;
    }
    if (r.status === "approved") return decidedAgo(r) < MY_APPROVED_WINDOW_MS;
    return false;
  });
}

// 변경 요청 행 → 착지 경로(순수) — 두 팝오버(대기열·내 요청)가 같은 계약을 복제하지 않게 SSOT.
// brand 쿼리 없이는 정규화 effect가 hl을 지우므로 brandId 없으면 이동 불가(null).
export function changeRequestDest(
  row: Pick<ChangeRequestItem, "id" | "kind" | "targetBrandId" | "targetModelId" | "targetTrimId">,
): string | null {
  if (row.targetBrandId == null) return null;
  if (row.targetModelId == null) return mcMasterPath(row.targetBrandId, undefined);
  // 신규 트림은 트림 id가 아직 없어 hl 마킹이 불가 — 미리보기 행을 요청 id(hlreq)로 마킹한다
  // (접힌 그룹 펼침+스크롤+플래시, 2026-08-03 실기: 링크가 모델로만 떨어져 어딨는지 안 보였다).
  const mark =
    row.targetTrimId != null ? `&hl=${row.targetTrimId}` : row.kind === "trim.create" ? `&hlreq=${row.id}` : "";
  return `${mcMasterPath(row.targetBrandId, row.targetModelId)}${mark}`;
}

const EMPTY_ROWS: ChangeRequestItem[] = [];

// 모델 목록 행 배지용 집계(2026-08-05) — 대기열 응답을 모델별로 센다.
// **서버를 새로 두지 않은 이유**: 목록 응답이 이미 모든 kind에 대해 `targetModelId`를 채워
// 준다(신규 트림은 payload.modelId에서 · 옵션은 옵션→트림→모델을 타고 — change-requests.ts의
// 좌표 헬퍼). 모델마다 따로 조회하면 브랜드당 N+1이 되고, 목록과 배지가 서로 다른 시점을 보게 된다.
// `targetModelId`가 null인 행(신규 모델 = 아직 목록에 없다, 대상이 삭제돼 좌표를 못 푼 행)은 뺀다.
export function pendingCountByModel(rows: ChangeRequestItem[] | null): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of rows ?? []) {
    if (row.targetModelId == null) continue;
    counts.set(row.targetModelId, (counts.get(row.targetModelId) ?? 0) + 1);
  }
  return counts;
}

// 브랜드 목록 배지용(2026-08-05) — 위와 같은 재료의 한 단계 위 집계.
// ⚠️ 모델 집계와 **합이 다를 수 있다**: 신규 모델 요청(model.create)은 브랜드 좌표만 있고
// targetModelId가 null이라 모델 배지엔 안 잡히지만 브랜드에는 잡힌다(그 브랜드에 결재할 게
// 있다는 건 사실이다). 그래서 둘을 서로의 검산으로 쓰지 말 것.
export function pendingCountByBrand(rows: ChangeRequestItem[] | null): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of rows ?? []) {
    if (row.targetBrandId == null) continue;
    counts.set(row.targetBrandId, (counts.get(row.targetBrandId) ?? 0) + 1);
  }
  return counts;
}

// 모델 단위 pending — 트림/옵션 행 "승인 대기" 배지(spec §7.2, admin·manager 공용). 조회 실패
// 무소음: 배지는 409를 미리 보여주는 예방선일 뿐 최종 방어는 서버 부분 UNIQUE다(초기 실패 = EMPTY,
// 재조회 실패 = 직전 rows 유지 — stale 배지가 없음보다 안전하다). modelId 전환 직후 이전 모델
// rows가 스치지 않게 응답을 modelId와 묶어 두고 소비 시점에 대조한다(effect 본문 setState 금지
// 관례라 초기화 대신 파생 필터). 큐가 움직이면(202 적재 = catalog.ts 채널 / 승인·반려·취소 = 이
// 모듈 채널) 즉시 재조회한다.
export function useModelPendingRequests(modelId: number | null, enabled: boolean): ChangeRequestItem[] {
  const [data, setData] = useState<{ modelId: number; rows: ChangeRequestItem[] } | null>(null);
  // 이 훅은 자체 재조회 트리거가 없다(reload 없음) — 신선도는 전적으로 아래 신호가 담당한다.
  // focus 그물까지 켠다 — broadcast가 못 닿는 구간(채널 미가입 사이·전송 유실)을 탭 복귀로 메운다.
  // 상시 interval은 두지 않는다: 최종 방어는 서버 부분 UNIQUE고, 배지는 409를 미리 보여주는
  // 예방선이라 탭 복귀 신선도면 충분하다.
  const signalTick = useCatalogQueueTick(enabled, { focus: true });
  useEffect(() => {
    if (!enabled || modelId == null) return;
    let alive = true;
    getJson<ChangeRequestItem[]>(`/api/catalog/models/${modelId}/change-requests`)
      .then((rows) => {
        if (alive) setData({ modelId, rows });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, modelId, signalTick]);
  return enabled && data != null && data.modelId === modelId ? data.rows : EMPTY_ROWS;
}

// 팀장 "내 요청" 팝오버(spec §7.3) — mine=1은 전 상태·최근 50건(서버 관례)이라 상태 구분은
// 클라 몫이다. 취소 성공은 notifyQueueUpdated로 알린다 — 모델 배지·(같은 브라우저의) 대기열이
// 60s 폴링을 기다리지 않고 따라온다. 내 저장이 202로 적재되면 (N)도 즉시 갱신(catalog.ts 채널).
export function useMyChangeRequests(enabled: boolean): {
  rows: ChangeRequestItem[] | null;
  failed: boolean;
  reload: () => void;
  cancel: (id: string) => Promise<void>;
} {
  const [rows, setRows] = useState<ChangeRequestItem[] | null>(enabled ? mineCache : null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  // ⚠️ **결정(승인·반려·취소)은 듣지 않는다**(decisions: false) — 같은 탭의 승인/반려는 admin 화면
  // 이벤트라 이 훅과 세션이 겹치지 않고, 내 취소는 아래 cancel이 직접 tick을 올린다. **타 세션의**
  // 결정은 broadcast가 실어 나른다(관리자가 처리하면 팀장 팝오버의 상태 칩이 리로딩 없이 뒤집힌다).
  const signalTick = useCatalogQueueTick(enabled, { decisions: false });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getJson<ChangeRequestItem[]>("/api/catalog/change-requests?mine=1")
      .then((list) => {
        mineCache = list; // 다음 마운트의 (N) 즉시 표시용(queueCache와 같은 결).
        if (!alive) return;
        setRows(list);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled, tick, signalTick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const cancel = useCallback(async (id: string) => {
    await sendJson(`/api/catalog/change-requests/${id}`, "DELETE");
    setTick((t) => t + 1);
    notifyQueueUpdated();
    broadcastCatalogQueueChanged(); // 관리자 대기열에서 그 행이 리로딩 없이 빠지게.
  }, []);
  return { rows, failed, reload, cancel };
}
