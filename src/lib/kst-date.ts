// KST 달력일 헬퍼 — 코퍼스 빌더(일정·서류함·앱 견적요청)·프롬프트 오늘 컨텍스트(withTodayContext)·
// 도구 실행기(오늘 일정)가 교차 소비하는 범용 시간 유틸(0706 배치 C에서 assistant-corpus의 일정 섹션에서
// 중립 이동). 같은 +9h 시프트 관용구가 business-code.yymmKstOf(YYMM 채번)·app-card-payload.stampLabelOf
// (타임스탬프 라벨)에도 있지만 출력 포맷이 달라 별개 함수로 둔다 — 달력일("YYYY-MM-DD")은 여기가 SSOT.

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

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
