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
  expect(report.delivery).toEqual({
    count: 0,
    prevCount: 0,
    leaseAmount: 0,
    prevLeaseAmount: 0,
    rentAmount: 0,
    prevRentAmount: 0,
    countByMethod: [], // 0건이면 빈 배열 — 화면이 소계 줄 자체를 안 그린다
  });
});

// 구매방식별 대수(2026-08-04, 이사님 확정 — spec 2026-08-03 §1). 실 데이터가 아직 없어 값 자체는
// 단언할 수 없고, **불변식**을 잠근다: 소계 합 == 전체 대수. 실적 금액은 화이트리스트
// (REVENUE_BASIS_BY_PURCHASE_METHOD)로 걸러지지만 **대수는 전 구매방식 포함**이라, 화이트리스트를
// 대수에도 잘못 적용하면 이 합이 어긋난다(할부·중고리스가 통째로 빠진다).
test("getAdminReport: 구매방식별 대수의 합은 전체 대수와 같다(전 구매방식 포함)", async () => {
  for (const month of ["2026-07", "2026-08"]) {
    const { delivery } = await getAdminReport(month);
    const sum = delivery.countByMethod.reduce((a, r) => a + r.count, 0);
    expect(sum).toBe(delivery.count);
    // 많은 순 정렬(동수는 이름 오름차순) — 순서가 흔들리면 새로고침마다 "숫자가 변한 것"으로 읽힌다.
    const counts = delivery.countByMethod.map((r) => r.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  }
});

test("getAdminReport: 실적은 출고 달 기준 기간 지표 — 이번 달과 전월이 맞물린다", async () => {
  // 스냅샷 지표(inProgress·contracted)와 달리 월 스코프가 실제로 작동해야 한다. 같은 데이터를
  // 두 달에서 보면 "8월의 전월" == "7월의 이번 달"이어야 한다 — 어긋나면 월 경계가 틀린 것이다
  // (delivered_date는 timestamptz가 아니라 date라 UTC 환산하면 하루가 밀린다).
  const [jul, aug] = await Promise.all([getAdminReport("2026-07"), getAdminReport("2026-08")]);
  expect(aug.delivery.prevCount).toBe(jul.delivery.count);
  expect(aug.delivery.prevLeaseAmount).toBe(jul.delivery.leaseAmount);
  expect(aug.delivery.prevRentAmount).toBe(jul.delivery.rentAmount);
});

test("getAdminReport: 실적 금액은 대수를 넘지 않는 관계 — 0건이면 금액도 0", async () => {
  const report = await getAdminReport("2026-08");
  if (report.delivery.count === 0) {
    expect(report.delivery.leaseAmount).toBe(0);
    expect(report.delivery.rentAmount).toBe(0);
  }
  // 금액은 음수가 될 수 없다(할인이 차량가를 넘기면 산식이 깨진 것).
  expect(report.delivery.leaseAmount).toBeGreaterThanOrEqual(0);
  expect(report.delivery.rentAmount).toBeGreaterThanOrEqual(0);
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
