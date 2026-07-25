import { test, expect } from "bun:test";

import { getCatalogCounts } from "./catalog-counts";

test("getCatalogCounts: 7테이블 활성 건수 반환", async () => {
  const c = await getCatalogCounts();
  // 정확 건수(브랜드 33·모델 265·트림 1669…) 하드코딩 금지(0725 경량 체크 L5) — 라이브 master
  // catalog는 MC 마스터·앱 팀이 편집하는 데이터라 트림 하나만 추가돼도 확정 red였다. 이 테스트의
  // 목적은 7테이블 count 배선이지 재고 조사가 아니다 — 존재 성질만 잠근다.
  expect(c.brands).toBeGreaterThan(0);
  expect(c.models).toBeGreaterThan(0);
  expect(c.trims).toBeGreaterThan(0);
  expect(c.trimOptions).toBeGreaterThan(0);
  expect(c.colors).toBeGreaterThan(0);
  expect(c.trimNoOptions).toBeGreaterThanOrEqual(0);
  expect(c.trimOptionRelations).toBeGreaterThanOrEqual(0);
});
