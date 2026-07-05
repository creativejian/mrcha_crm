// 업무 코드 채번 공통 순수 로직 — nextQuoteCode(QT)·nextCustomerCode(CU)가 공유한다(동형 복제 해소).
// 코드 체계는 ref/business-code-system.md(QT/CU/CS/CT/DV/ST — 새 접두 추가 시 이 헬퍼 재사용).

// KST 고정 YYMM. 로컬 시간(new Date의 getFullYear 등) 기준이면 CF Workers(UTC)에서
// 매월 1일 00:00~09:00 KST 생성분이 전월 코드로 채번된다(로컬 dev와 prod가 갈라짐) — UTC+9 환산으로 통일.
export function yymmKstOf(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return `${String(kst.getUTCFullYear()).slice(2)}${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

// prefix(`QT-2607-` 형태) 하위 기존 코드들의 최대 시퀀스 +1. 형식 이탈 코드는 무시, 없으면 0001.
export function nextSequenceCode(prefix: string, codes: string[]): string {
  const max = codes.reduce((m, code) => {
    const match = code.match(/-(\d{4})$/);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
