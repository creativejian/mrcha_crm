import { test, expect } from "bun:test";

import { getAdminReport } from "./reports";

// 실 DB(공유 master) 의존 — **읽기 전용이고 픽스처를 만들지 않는다**(집계 쿼리라 행이 필요 없다).
// db-bound-tests registry에 등록돼 CI `test:pure`에서는 제외된다.
//
// 이 파일이 잡는 것 = 집계 SQL의 **문법·바인딩 회귀**다. 2026-08-02 구현 중 두 번 밟았다:
// ①raw sql 템플릿에 Date를 넣어 postgres.js 직렬화가 던짐 ②`= any(${배열})`이 튜플로 펼쳐져
// Postgres가 거부. 둘 다 타입체크를 통과하고 런타임에만 죽는 부류라 typecheck로는 못 막는다.

test("getAdminReport: 데이터가 없는 미래 월은 기간 지표가 전부 0(쿼리는 정상 실행)", async () => {
  const report = await getAdminReport("2099-01");
  expect(report.month).toBe("2099-01");
  expect(report.prevMonth).toBe("2098-12");
  expect(report.overview.newInflow.count).toBe(0);
  expect(report.overview.quotesSent.count).toBe(0);
  expect(report.overview.quotesSent.viewedCount).toBe(0);
  expect(report.brandInquiries.total).toBe(0);
  expect(report.brandInquiries.rows).toEqual([]);
  expect(report.quoteFunnel).toEqual({ created: 0, sent: 0, viewed: 0, contracting: 0 });
});

test("getAdminReport: 스냅샷 지표는 월과 무관하게 같다 — spec §2a 한계의 회귀 그물", async () => {
  const [past, future] = await Promise.all([getAdminReport("2026-07"), getAdminReport("2099-01")]);
  // 상태 전이 시각 컬럼이 없어 월 스코프가 불가능하다. 여기가 깨졌다면 전이 이력이 생겼다는 뜻이고,
  // 그때는 UI의 "현재 기준" 표기와 이 테스트를 함께 걷어야 한다(표기만 남으면 거짓말이 된다).
  expect(future.overview.inProgress.count).toBe(past.overview.inProgress.count);
  expect(future.overview.contracted.count).toBe(past.overview.contracted.count);
  expect(future.overview.upcomingDeliveries.count).toBe(past.overview.upcomingDeliveries.count);
});

test("getAdminReport: 퍼널은 단조 — 열람은 발송 코호트의 부분집합", async () => {
  const report = await getAdminReport("2026-07");
  expect(report.quoteFunnel.viewed).toBeLessThanOrEqual(report.quoteFunnel.sent);
  // 발송 칩과 퍼널 송출은 같은 원천이라 어긋나면 화면 두 곳이 다른 숫자를 말한다.
  expect(report.overview.quotesSent.count).toBe(report.quoteFunnel.sent);
  expect(report.overview.quotesSent.viewedCount).toBe(report.quoteFunnel.viewed);
});

test("getAdminReport: 브랜드 total은 행 합과 일치하고 내림차순 정렬", async () => {
  const report = await getAdminReport("2026-05");
  const sum = report.brandInquiries.rows.reduce((acc, row) => acc + row.count, 0);
  expect(report.brandInquiries.total).toBe(sum);
  const counts = report.brandInquiries.rows.map((row) => row.count);
  expect([...counts].sort((a, b) => b - a)).toEqual(counts);
});
