import { finalUpdateStatus, finalUpdateStatusFromManage, type FinalUpdateInfo, type FinalUpdateStatus, type ManageStatusOption } from "./customer-table";

// 목록 Customer·상세 훅이 구조적 타이핑으로 그대로 넘길 수 있는 최소 입력.
// lastActivityAt = 서버 파생 GREATEST(customers.updated_at, 자식 max(created_at)) ISO.
export type ManageStatusSource = {
  lastActivityAt?: string | null;
  recontacted?: boolean;
  statusGroup: string;
  status: string;
};

const MS_DAY = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
// KST 달력일 인덱스 — 서버 kst-date.kstDayIndex와 같은 산술(물리 공유 불가: 클라 런타임은 src/를 import
// 하지 않는다). 브라우저 로컬 tz를 쓰면 해외 tz에서 서버 도구(stale_customers)와 일수가 갈린다.
// 동치는 manage-status-parity.test.ts가 잠근다.
const kstDayIndex = (d: Date) => Math.floor((d.getTime() + KST_OFFSET_MS) / MS_DAY);

// mock initialFinalUpdateByCustomerId를 대체하는 실데이터 파생.
// - 신규·상담접수(아직 담당자 액션 없음) → null(목록/상세 공백 규칙 유지)
// - recontacted → customerRecontacted(버킷 판정은 finalUpdateStatus 소관 — 재문의 우선)
// - label은 "N월 N일 HH:mm" — customer-table.operationDateValue가 파싱하는 기존 포맷 유지(응답 SLA 표시 호환)
// - days는 KST 달력일 차이(기존 mock 의미) — 어제 활동은 시각 무관 1일. 서버 도구(stale_customers·
//   delivery_risk)의 kstDayDiff와 같은 지표라야 목록 배지와 AI 리포트가 모순되지 않는다(0709 감사)
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
    label: `${at.getMonth() + 1}월 ${at.getDate()}일 ${p(at.getHours())}:${p(at.getMinutes())}`,
    atIso: at.toISOString(),
    days: Math.max(0, kstDayIndex(now) - kstDayIndex(at)),
    customerRecontacted: source.recontacted || undefined,
  };
}

// override 합성 규칙 SSOT — 목록 필터·행 렌더·상세 워크플로우 3곳이 공유(한쪽만 픽스되는 드리프트 방지).
// finalUpdateOverride: "방금 전" 로컬 갱신 마킹(파생 대체), manageStatusOverride: 워크플로우 카드의 수동 상태(버킷 강제).
export function resolveUpdateBadge(
  source: ManageStatusSource,
  opts: { finalUpdateOverride?: FinalUpdateInfo | null; manageStatusOverride?: ManageStatusOption | null; now?: Date } = {},
): { info: FinalUpdateInfo | null; status: FinalUpdateStatus | null } {
  const info = opts.finalUpdateOverride ?? deriveFinalUpdateInfo(source, opts.now);
  const status = opts.manageStatusOverride
    ? finalUpdateStatusFromManage(opts.manageStatusOverride)
    : info ? finalUpdateStatus(info) : null;
  return { info, status };
}
