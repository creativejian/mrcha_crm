import type { FinalUpdateInfo } from "./customer-table";

// 목록 Customer·상세 훅이 구조적 타이핑으로 그대로 넘길 수 있는 최소 입력.
// lastActivityAt = 서버 파생 GREATEST(customers.updated_at, 자식 max(created_at)) ISO.
export type ManageStatusSource = {
  lastActivityAt?: string | null;
  recontacted?: boolean;
  statusGroup: string;
  status: string;
};

// mock initialFinalUpdateByCustomerId를 대체하는 실데이터 파생.
// - 신규·상담접수(아직 담당자 액션 없음) → null(목록/상세 공백 규칙 유지)
// - recontacted → customerRecontacted(버킷 판정은 finalUpdateStatus 소관 — 재문의 우선)
// - label은 "N월 N일 HH:mm" — customer-table.operationDateValue가 파싱하는 기존 포맷 유지(응답 SLA 표시 호환)
export function deriveFinalUpdateInfo(
  source: ManageStatusSource,
  now: Date = new Date()
): FinalUpdateInfo | null {
  if (source.statusGroup === "신규" && source.status === "상담접수") return null;
  if (!source.lastActivityAt) return null;
  const at = new Date(source.lastActivityAt);
  if (Number.isNaN(at.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    action: "최근 활동 업데이트",
    field: "최근 활동",
    label: `${at.getMonth() + 1}월 ${at.getDate()}일 ${p(at.getHours())}:${p(at.getMinutes())}`,
    days: Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000)),
    customerRecontacted: source.recontacted || undefined,
  };
}
