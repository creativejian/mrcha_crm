import { useCallback, useEffect, useState } from "react";

import { mcMasterPath } from "@/pages/mc-master/mc-master-route";

import { onCatalogWriteQueued } from "./catalog";
import { CHANGE_FIELD_LABELS, OPTION_TYPE_VALUE_LABELS, type ChangeRequestKind } from "./catalog-change-kinds";
import { broadcastCatalogQueueChanged, onCatalogQueueRemoteChanged } from "./catalog-change-realtime";
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

// 마지막 응답의 모듈 캐시(dealer-roster getCachedMyProposalTrims 선례) — 헤더 버튼 (N)이
// 재마운트 직후(메뉴 이동·모델 전환 재진입) 숫자 없는 라벨로 깜빡이지 않게 직전 값을 즉시
// 보여주고, fetch가 도착하면 갱신한다. 브라우저 새로고침(F5)은 모듈이 초기화되므로 여전히
// 첫 fetch 후에 뜬다 — 세션 스토리지 영속화는 stale 위험 대비 과함.
let queueCache: ChangeRequestItem[] | null = null;
let mineCache: ChangeRequestItem[] | null = null;

// 테스트 전용 — 모듈 캐시 초기화(케이스 간 오염 방지, resetStaffDirectoryCache 관례).
export function resetChangeRequestCachesForTest(): void {
  queueCache = null;
  mineCache = null;
}

// 대기열 변동 알림(모듈 레벨 pub/sub) — 팝오버에서 승인/반려하면 사이드바 배지(App 폴링)가
// 60s를 기다리지 않고 즉시 재조회한다(dealer-roster의 invalidate 선례와 같은 결).
const queueListeners = new Set<() => void>();
export function onChangeRequestQueueUpdated(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
}
function notifyQueueUpdated() {
  for (const l of queueListeners) l();
}

export function useChangeRequestQueue(enabled: boolean): {
  rows: ChangeRequestItem[] | null; // null = 미로드/로딩
  failed: boolean;
  reload: () => void;
  approve: (id: string) => Promise<void>;
  reject: (id: string, reason: string) => Promise<void>;
} {
  const [rows, setRows] = useState<ChangeRequestItem[] | null>(queueCache);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  // ⚠️ setState는 **콜백 안에서** 부른다(react-hooks/set-state-in-effect 기준선 0 — discount-proposals.ts 관례).
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getJson<ChangeRequestItem[]>(QUEUE_URL)
      .then((list) => {
        queueCache = list; // 다음 마운트의 (N) 즉시 표시용 — alive와 무관하게 최신값 보관.
        if (!alive) return;
        setRows(list);
        setFailed(false);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // 다른 세션(팀장 적재/취소)의 변동을 리로딩 없이 반영한다(broadcast — catalog-change-realtime).
  useEffect(() => (enabled ? onCatalogQueueRemoteChanged(() => setTick((t) => t + 1)) : undefined), [enabled]);

  // 성공 시에만 재조회 — 실패(409 드리프트 등)는 throw로 올라가 호출한 팝오버가 행별로 표시한다.
  // broadcast는 상대 세션(팀장 배지·내 요청) 몫 — 내 화면은 tick·notify가 즉시 갱신한다.
  const approve = useCallback(async (id: string) => {
    await sendJson(`/api/catalog/change-requests/${id}/approve`, "POST");
    setTick((t) => t + 1);
    notifyQueueUpdated();
    broadcastCatalogQueueChanged();
  }, []);

  const reject = useCallback(async (id: string, reason: string) => {
    await sendJson(`/api/catalog/change-requests/${id}/reject`, "POST", { reason });
    setTick((t) => t + 1);
    notifyQueueUpdated(); // 반려도 pending 카운트가 줄어드므로 승인과 동일하게 알린다.
    broadcastCatalogQueueChanged();
  }, []);

  return { rows, failed, reload, approve, reject };
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
  row: Pick<ChangeRequestItem, "targetBrandId" | "targetModelId" | "targetTrimId">,
): string | null {
  if (row.targetBrandId == null) return null;
  if (row.targetModelId == null) return mcMasterPath(row.targetBrandId, undefined);
  return `${mcMasterPath(row.targetBrandId, row.targetModelId)}${row.targetTrimId != null ? `&hl=${row.targetTrimId}` : ""}`;
}

const EMPTY_ROWS: ChangeRequestItem[] = [];

// 모델 단위 pending — 트림/옵션 행 "승인 대기" 배지(spec §7.2, admin·manager 공용). 조회 실패
// 무소음: 배지는 409를 미리 보여주는 예방선일 뿐 최종 방어는 서버 부분 UNIQUE다(초기 실패 = EMPTY,
// 재조회 실패 = 직전 rows 유지 — stale 배지가 없음보다 안전하다). modelId 전환 직후 이전 모델
// rows가 스치지 않게 응답을 modelId와 묶어 두고 소비 시점에 대조한다(effect 본문 setState 금지
// 관례라 초기화 대신 파생 필터). 큐가 움직이면(202 적재 = catalog.ts 채널 / 승인·반려·취소 = 이
// 모듈 채널) 즉시 재조회한다.
export function useModelPendingRequests(modelId: number | null, enabled: boolean): ChangeRequestItem[] {
  const [data, setData] = useState<{ modelId: number; rows: ChangeRequestItem[] } | null>(null);
  const [tick, setTick] = useState(0);
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
  }, [enabled, modelId, tick]);
  useEffect(() => onCatalogWriteQueued(() => setTick((t) => t + 1)), []);
  useEffect(() => onChangeRequestQueueUpdated(() => setTick((t) => t + 1)), []);
  // 타 세션의 변동은 broadcast 신호로 즉시 따라온다(catalog-change-realtime — 2026-07-31).
  useEffect(() => (enabled ? onCatalogQueueRemoteChanged(() => setTick((t) => t + 1)) : undefined), [enabled]);
  // broadcast가 못 닿는 구간(채널 미가입 사이·전송 유실)의 그물 — 탭 복귀 시점에 재검증한다
  // (사이드바 배지의 focus 재조회 선례). 상시 interval은 두지 않는다: 최종 방어는
  // 서버 부분 UNIQUE고, 배지는 예방선이라 탭 복귀 신선도면 충분하다.
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => setTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled]);
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
  }, [enabled, tick]);
  useEffect(() => onCatalogWriteQueued(() => setTick((t) => t + 1)), []);
  // onChangeRequestQueueUpdated는 구독하지 않는다 — 같은 탭의 승인/반려는 admin 화면 이벤트라
  // 이 훅과 세션이 겹치지 않고, 내 취소는 cancel이 직접 tick을 올린다. **타 세션의** 승인/반려는
  // 아래 broadcast 신호가 실어 나른다(catalog-change-realtime — 2026-07-31): 관리자가 처리하면
  // 팀장 팝오버의 상태 칩이 리로딩 없이 뒤집힌다.
  useEffect(() => (enabled ? onCatalogQueueRemoteChanged(() => setTick((t) => t + 1)) : undefined), [enabled]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const cancel = useCallback(async (id: string) => {
    await sendJson(`/api/catalog/change-requests/${id}`, "DELETE");
    setTick((t) => t + 1);
    notifyQueueUpdated();
    broadcastCatalogQueueChanged(); // 관리자 대기열에서 그 행이 리로딩 없이 빠지게.
  }, []);
  return { rows, failed, reload, cancel };
}
