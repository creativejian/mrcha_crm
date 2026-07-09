// KST 달력일 헬퍼 — 코퍼스 빌더(일정·서류함·앱 견적요청)·프롬프트 오늘 컨텍스트(withTodayContext)·
// 도구 실행기(오늘 일정)가 교차 소비하는 범용 시간 유틸(0706 배치 C에서 assistant-corpus의 일정 섹션에서
// 중립 이동). 같은 +9h 시프트 관용구가 business-code.yymmKstOf(YYMM 채번)·app-card-payload.stampLabelOf
// (타임스탬프 라벨)에도 있지만 출력 포맷이 달라 별개 함수로 둔다 — 달력일("YYYY-MM-DD")은 여기가 SSOT.

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const KST_OFFSET_MS = 9 * 3_600_000;
const MS_DAY = 86_400_000;

// "YYYY-MM-DD"(drizzle date 컬럼) → "YYYY-MM-DD(요일)". 파싱 불가 문자열은 요일 없이 원문 유지(방어).
export function dateLabelOf(dateStr: string): string {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isNaN(t) ? dateStr : `${dateStr}(${WEEKDAYS[new Date(t).getUTCDay()]})`;
}

// Date → KST 달력일 "YYYY-MM-DD". 로컬 getDate 기준이면 CF Workers(UTC)에서 00:00~09:00 KST 구간이
// 전날로 밀린다(business-code yymmKstOf와 동일 이유) — UTC+9 환산으로 통일.
export function kstDateOf(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// Date → KST 달력일 라벨(요일 병기).
export function kstDateLabel(now: Date): string {
  return dateLabelOf(kstDateOf(now));
}

// Date → KST 달력일 인덱스(에폭 이후 KST 기준 며칠째). 같은 달력일이면 시각과 무관하게 같은 값.
export function kstDayIndex(d: Date): number {
  return Math.floor((d.getTime() + KST_OFFSET_MS) / MS_DAY);
}

// 두 시각 사이의 KST 달력일 차 — "며칠이 바뀌었나"이지 경과 시간의 24h 내림이 아니다.
// 관리 상태 버킷 임계(7/15/30, activity.STALE_THRESHOLDS)가 달력일이라 목록 배지(클라 manage-status)와
// AI 리포트(stale_customers·delivery_risk)가 이 지표를 공유해야 경계에서 화면 내 모순이 안 난다.
// floor(경과/24h)를 쓰면 활동 7일 전 13:00 · 지금 12:00이 6일로 잡혀 리포트에서만 누락된다(0709 감사).
// 한국은 고정 UTC+9·DST 없음이라 서버(CF Workers UTC)가 KST 달력일을 결정론적으로 재현한다.
// 음수(미래 시각)도 그대로 반환한다 — 0 클램프는 호출부 책임.
export function kstDayDiff(from: Date, to: Date): number {
  return kstDayIndex(to) - kstDayIndex(from);
}
