import { useCallback, useEffect, useState } from "react";

import { CHANGE_FIELD_LABELS, OPTION_TYPE_VALUE_LABELS, type ChangeRequestKind } from "./catalog-change-kinds";
import { getJson, sendJson } from "./http";

// MC 마스터 변경 승인 대기열 — 관리자 팝오버(ChangeRequestQueue, Task 4)가 소비한다.
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
  targetLabel: string;
  targetBrandId: number | null;
  targetModelId: number | null;
  targetTrimId: number | null;
};

const QUEUE_URL = "/api/catalog/change-requests?status=pending";

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
  const [rows, setRows] = useState<ChangeRequestItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  // ⚠️ setState는 **콜백 안에서** 부른다(react-hooks/set-state-in-effect 기준선 0 — discount-proposals.ts 관례).
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getJson<ChangeRequestItem[]>(QUEUE_URL)
      .then((list) => {
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

  // 성공 시에만 재조회 — 실패(409 드리프트 등)는 throw로 올라가 호출한 팝오버가 행별로 표시한다.
  const approve = useCallback(async (id: string) => {
    await sendJson(`/api/catalog/change-requests/${id}/approve`, "POST");
    setTick((t) => t + 1);
    notifyQueueUpdated();
  }, []);

  const reject = useCallback(async (id: string, reason: string) => {
    await sendJson(`/api/catalog/change-requests/${id}/reject`, "POST", { reason });
    setTick((t) => t + 1);
    notifyQueueUpdated(); // 반려도 pending 카운트가 줄어드므로 승인과 동일하게 알린다.
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
