import { finalUpdateStatus, finalUpdateStatusFromManage, type FinalUpdateInfo, type FinalUpdateStatus, type ManageStatusOption } from "./customer-table";

// 목록 Customer·상세 훅이 구조적 타이핑으로 그대로 넘길 수 있는 최소 입력.
// lastActivityAt = 서버 파생 GREATEST(customers.updated_at, 자식 max(created_at)) ISO.
export type ManageStatusSource = {
  lastActivityAt?: string | null;
  recontacted?: boolean;
  manageStatus?: string | null; // 수동 관리 상태(⑦-① 스누즈) — 아래 effectiveManageStatus가 유효성 판정
  manageStatusAt?: string | null;
  statusGroup: string;
  status: string;
};

// 수동 관리 상태(스누즈) 유효 판정 — manage_status_at이 마지막 실활동 이후거나 **동시**면 유효(설정
// PATCH가 두 스탬프를 같은 now로 찍는다 — 서버 updateCustomer 계약), 이후 실활동이 기록되면 만료.
// 서버 동치는 activity.manualManageStatusActive — 파리티 테스트(manage-status-parity)가 잠근다.
export function effectiveManageStatus(source: ManageStatusSource): ManageStatusOption | null {
  if (!source.manageStatus || !source.manageStatusAt) return null;
  const m = new Date(source.manageStatusAt).getTime();
  if (Number.isNaN(m)) return null;
  if (source.lastActivityAt) {
    const a = new Date(source.lastActivityAt).getTime();
    if (!Number.isNaN(a) && m < a) return null;
  }
  return source.manageStatus as ManageStatusOption;
}

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

// 유효 수동 상태의 팝오버용 표시 정보 — 신규·상담접수(파생 info null)라도 수동 배지는 표시해야 하므로
// (수동 지정 자체가 상담사 액션 — 배치 4 B2 기각 번복 2026-07-14) manageStatusAt으로 합성한다.
// deriveFinalUpdateInfo에 합치지 않는 이유: 그 반환은 응답 SLA(firstResponseDisplay)의 입력이기도 한데
// 수동 지정은 고객 응대가 아니다 — 응답 "대기 중"은 유지돼야 한다. 팝오버 폴백 전용.
export function manualUpdateInfo(
  source: ManageStatusSource,
  now: Date = new Date()
): FinalUpdateInfo | null {
  if (!effectiveManageStatus(source) || !source.manageStatusAt) return null;
  const at = new Date(source.manageStatusAt);
  if (Number.isNaN(at.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    action: "관리 상태 수동 지정",
    label: `${at.getMonth() + 1}월 ${at.getDate()}일 ${p(at.getHours())}:${p(at.getMinutes())}`,
    atIso: at.toISOString(),
    days: Math.max(0, kstDayIndex(now) - kstDayIndex(at)),
  };
}

// 배지 합성 규칙 SSOT — 목록 필터·행 렌더·상세 워크플로우 3곳이 공유(한쪽만 픽스되는 드리프트 방지).
// finalUpdateOverride: "방금 전" 로컬 갱신 마킹(파생 대체).
// 수동 관리 상태는 row(manageStatus/manageStatusAt)가 단일 소스 — 낙관 반영도 App이 row를 직접 갱신한다
// (구 manageStatusOverride 옵션은 삭제 경로가 없어 만료·리로드를 가리던 이중 소스라 폐기 — 0713 감사).
// 우선순위: 유효 수동 상태(스누즈, ⑦-①) > 파생(재문의→버킷).
export function resolveUpdateBadge(
  source: ManageStatusSource,
  opts: { finalUpdateOverride?: FinalUpdateInfo | null; now?: Date } = {},
): { info: FinalUpdateInfo | null; status: FinalUpdateStatus | null } {
  const info = opts.finalUpdateOverride ?? deriveFinalUpdateInfo(source, opts.now);
  const manual = effectiveManageStatus(source);
  const status = manual
    ? finalUpdateStatusFromManage(manual)
    : info ? finalUpdateStatus(info) : null;
  return { info, status };
}
