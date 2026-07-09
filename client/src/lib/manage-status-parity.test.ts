import { expect, test } from "vitest";

// 서버 모듈 테스트 전용 import(quick-prompt-tools 파리티와 동일 패턴) — 런타임 번들에는 유입되지 않는다.
import { STALE_THRESHOLDS } from "../../../src/db/queries/activity";
import { kstDayDiff } from "../../../src/lib/kst-date";

import { finalUpdateStatus, type FinalUpdateInfo } from "./customer-table";
import { deriveFinalUpdateInfo } from "./manage-status";

// 관리 상태 버킷 임계 파리티 — 서버 도구(stale_customers/delivery_risk)와 클라 목록 배지가 같은 달력일
// 임계를 봐야 "응답 지연" 리포트와 화면 배지가 모순되지 않는다(0706 배치 B — 활동 파생 seam).
const info = (days: number): FinalUpdateInfo => ({ action: "", label: "", atIso: "", days });

test("서버 STALE_THRESHOLDS ↔ 클라 finalUpdateStatus 버킷 경계 일치", () => {
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.review - 1)).label).toBe("정상");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.review)).label).toBe("확인필요");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.delayed - 1)).label).toBe("확인필요");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.delayed)).label).toBe("지연");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.abandoned - 1)).label).toBe("지연");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.abandoned)).label).toBe("장기방치");
});

// 임계만 잠그면 그 임계에 넣는 **일수 계산법**이 갈린다(0709 감사): 서버가 floor(경과/24h), 클라가
// 달력일 차이면 활동 7일 전 13:00 · 지금 12:00인 고객이 목록 배지 '확인필요'인데 AI stale 리포트엔
// 안 뜬다(같은 화면 안에서 모순 — #180이 자식 집합 드리프트로 없앤 것과 같은 부류).
// tz 무관해야 한다 — 클라가 브라우저 로컬 달력일을 쓰면 해외 tz에서 서버(KST)와 어긋난다.
// (`TZ=America/New_York bun run test:unit`으로 실증 가능.)
test("서버 kstDayDiff ↔ 클라 deriveFinalUpdateInfo.days — KST 달력일 동치(tz 무관)", () => {
  const cases: Array<[at: string, now: string, days: number]> = [
    ["2026-01-01T13:00:00+09:00", "2026-01-08T12:00:00+09:00", STALE_THRESHOLDS.review], // 경과 6일 23시간
    ["2026-01-07T23:59:00+09:00", "2026-01-08T00:01:00+09:00", 1], // 경과 2분, 자정 넘김
    ["2026-01-08T00:00:00+09:00", "2026-01-08T23:59:00+09:00", 0], // 같은 KST 달력일
    ["2026-01-01T00:00:00+09:00", "2026-01-31T00:00:00+09:00", STALE_THRESHOLDS.abandoned],
  ];
  for (const [atIso, nowIso, days] of cases) {
    const now = new Date(nowIso);
    const clientDays = deriveFinalUpdateInfo({ lastActivityAt: atIso, statusGroup: "견적", status: "견적상담중" }, now)?.days;
    expect(clientDays).toBe(days);
    expect(kstDayDiff(new Date(atIso), now)).toBe(days);
  }
});
