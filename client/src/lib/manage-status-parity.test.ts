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

// 수동 관리 상태(스누즈, ⑦-①) 유효 판정 동치 — 서버 도구(stale_customers/delivery_risk)와 클라 배지가
// 같은 경계(동시=유효 포함)를 봐야 "목록은 수동 정상인데 AI 리포트엔 장기방치" 모순이 재발하지 않는다.
test("서버 manualManageStatusActive ↔ 클라 effectiveManageStatus — 스누즈 경계 동치", async () => {
  const { manualManageStatusActive } = await import("../../../src/db/queries/activity");
  const { effectiveManageStatus } = await import("./manage-status");
  const cases: Array<[manageAt: string | null, activityAt: string | null, active: boolean]> = [
    ["2026-07-01T10:00:00+09:00", "2026-07-01T10:00:00+09:00", true], // 동시(PATCH 동일 스탬프) = 유효
    ["2026-07-01T10:00:00.001+09:00", "2026-07-01T10:00:00+09:00", true], // 1ms 이후 = 유효
    ["2026-07-01T09:59:59.999+09:00", "2026-07-01T10:00:00+09:00", false], // 1ms 이전 = 만료
    ["2026-07-01T10:00:00+09:00", null, true], // 활동 전 설정 = 유효
    [null, "2026-07-01T10:00:00+09:00", false], // 스탬프 없음 = 무효
  ];
  for (const [manageAt, activityAt, active] of cases) {
    expect(manualManageStatusActive(manageAt, activityAt)).toBe(active);
    const client = effectiveManageStatus({
      statusGroup: "견적", status: "견적상담중",
      lastActivityAt: activityAt, manageStatus: manageAt ? "지연" : null, manageStatusAt: manageAt,
    });
    expect(client != null).toBe(active);
  }
});
