// 탈퇴 인지 큐 API(2026-08-01) — spec: ref/specs/2026-08-01-crm-account-deletion-flow-design.md §4.
// 서버가 진짜 게이트다(딜러 403·staff 담당자 스코프·B retentionUntil 필수) — 클라 게이트는 UX 보조.
// 캐시는 인박스 관례(quote-requests.ts)의 TTL + inflight dedupe에, 목록·드로어가 같은 데이터를
// 보도록 모듈 pub/sub(MC 마스터 승인 대기 배지 선례)를 더했다 — 확인 실행 직후 강제 재fetch가
// 구독자(목록 배지·알림)를 즉시 갱신한다.
import { getJson, sendJson } from "./http";

export type DeletionClassification = "purge" | "active_fulfillment" | "settlement_reference";

export type DeletionJob = {
  id: string;
  customerId: string | null;
  customerCode: string | null;
  proposedClassification: DeletionClassification;
  requestedAt: string;
  customerName: string | null;
  advisorId: string | null;
  advisorName: string | null;
};

// 확인 화면 라벨 — 분류 어휘의 표시 SSOT(서버 값은 영문 코드).
export const DELETION_CLASSIFICATION_LABELS: Record<DeletionClassification, string> = {
  purge: "전량 삭제 (계약 전·거래 없음)",
  active_fulfillment: "한시 보존 (출고 업무 진행 중)",
  settlement_reference: "정산 참조만 보존 (출고 후 정산·환수 기간)",
};

const TTL_MS = 60_000;
let cache: { value: DeletionJob[]; at: number } | null = null;
let inflight: Promise<DeletionJob[]> | null = null;
const listeners = new Set<(jobs: DeletionJob[]) => void>();

export function subscribeDeletionJobs(listener: (jobs: DeletionJob[]) => void): () => void {
  listeners.add(listener);
  if (cache) listener(cache.value);
  return () => listeners.delete(listener);
}

export function fetchDeletionJobsCached(force = false): Promise<DeletionJob[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value);
  if (!force && inflight) return inflight;
  const p = getJson<DeletionJob[]>("/api/account-deletions")
    .then((rows) => {
      cache = { value: rows, at: Date.now() };
      for (const l of listeners) l(rows);
      return rows;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = p;
  return p;
}

export type ConfirmDeletionBody = {
  classification: DeletionClassification;
  /** B 전용(서버 필수 검증 — 미래 시각 ISO). */
  retentionUntil?: string;
  retentionBasis?: string;
  /** C 전용(YYYY-MM-DD, 선택 — 입력 시 정산 레코드가 pending으로 승격). */
  clawbackUntil?: string;
};

// 탈퇴확인 = 인지 + 분류 확정(삭제 거부권 아님 — 이사님 결정 2026-08-01). 성공 시 큐 캐시를
// 강제 재fetch해 구독 화면(목록 알림·배지)을 즉시 갱신한다. 상세 캐시 무효화는 호출부 책임.
export async function confirmAccountDeletion(jobId: string, body: ConfirmDeletionBody): Promise<void> {
  await sendJson<{ ok: boolean }>(`/api/account-deletions/${jobId}/confirm`, "POST", body);
  await fetchDeletionJobsCached(true).catch(() => {});
}
