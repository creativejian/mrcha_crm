// 경영 리포트 월 경계 순수 로직 — spec: ref/specs/2026-08-02-crm-admin-report-live-design.md §2.
// 리포트의 모든 기간 지표는 **KST 월 경계**로 자른다. UTC 기준으로 자르면 매월 1일 00:00~09:00 KST
// 유입이 전월로 새고, 로컬 dev(KST)와 prod(CF Workers=UTC)의 결과가 갈라진다 — `yymmKstOf`
// (business-code.ts)가 같은 이유로 UTC+9 환산을 쓴다. 여기서도 그 관용구를 따른다.

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): boolean {
  return MONTH_KEY.test(value);
}

// KST 기준 현재 월(YYYY-MM). month 파라미터 생략 시 라우트의 기본값.
export function currentMonthKey(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parse(month: string): { year: number; month: number } {
  const m = MONTH_KEY.exec(month);
  if (!m) throw new Error(`invalid month key: ${month}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function prevMonthKey(month: string): string {
  const { year, month: mon } = parse(month);
  const prev = mon === 1 ? { y: year - 1, m: 12 } : { y: year, m: mon - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, "0")}`;
}

// 그 달의 경계를 **날짜(date) 문자열**로. `customer_deliveries.delivered_date`처럼 timestamptz가 아니라
// date인 컬럼용이다 — 사용자가 친 달력 날짜 그대로라 타임존 환산 대상이 아니고, UTC 시각으로 비교하면
// 월 경계에서 하루가 밀린다. 상한 배타(다음 달 1일).
export function monthRangeDate(month: string): { start: string; end: string } {
  const { year, month: mon } = parse(month);
  const next = mon === 12 ? { y: year + 1, m: 1 } : { y: year, m: mon + 1 };
  return { start: `${month}-01`, end: `${next.y}-${String(next.m).padStart(2, "0")}-01` };
}

// 그 달의 KST 경계를 UTC 시각으로. 상한 배타 — 쿼리는 `>= start AND < end`로 쓴다
// (`<= 말일 23:59:59`는 그 사이 마이크로초를 흘린다).
export function monthRangeUtc(month: string): { start: Date; end: Date } {
  const { year, month: mon } = parse(month);
  // Date.UTC(y, m, 1)이 KST 1일 00:00이려면 9시간을 뺀다.
  const start = new Date(Date.UTC(year, mon - 1, 1) - 9 * 3_600_000);
  const end = new Date(Date.UTC(year, mon, 1) - 9 * 3_600_000);
  return { start, end };
}
