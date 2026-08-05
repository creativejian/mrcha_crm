import { describe, expect, it } from "vitest";

import type { ChangeRequestKind } from "./catalog-change-kinds";
import {
  buildChangeDiff,
  type ChangeRequestItem,
  changeRequestDest,
  filterMyRequestVisible,
  pendingCountByModel,
} from "./catalog-change-requests";

describe("buildChangeDiff", () => {
  it("trim.update — 변경 필드만 전→후 표시(천단위 콤마)", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { price: 50000000 },
        snapshot: { price: 45000000 },
      }),
    ).toEqual([{ label: "가격", before: "45,000,000", after: "50,000,000" }]);
  });

  it("null→값 — before는 null, after는 값", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { driveSystem: "AWD" },
        snapshot: { driveSystem: null },
      }),
    ).toEqual([{ label: "구동방식", before: null, after: "AWD" }]);
  });

  it("model.create — 부모 id(brandId) 제외 + create는 before 전부 null, 빈 값은 —", () => {
    expect(
      buildChangeDiff({
        kind: "model.create",
        payload: { brandId: 3, name: "테스트모델", category: null },
        snapshot: {},
      }),
    ).toEqual([
      { label: "이름", before: null, after: "테스트모델" },
      { label: "카테고리", before: null, after: "—" },
    ]);
  });

  it("trim.no-option.set/unset — 빈 배열(kind 라벨이 전부)", () => {
    expect(buildChangeDiff({ kind: "trim.no-option.set", payload: {}, snapshot: {} })).toEqual([]);
    expect(buildChangeDiff({ kind: "trim.no-option.unset", payload: {}, snapshot: {} })).toEqual([]);
  });

  it("modelYear — 콤마 없이 표기(2,024는 오표기)", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { modelYear: 2027 },
        snapshot: { modelYear: 2026 },
      }),
    ).toEqual([{ label: "연식", before: "2026", after: "2027" }]);
  });

  it("알 수 없는 키 — 라벨 폴백(키 그대로)", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { unknownField: "값" },
        snapshot: { unknownField: "이전값" },
      }),
    ).toEqual([{ label: "unknownField", before: "이전값", after: "값" }]);
  });

  // TrimEditPanel은 13필드 전체를 매번 PATCH한다 — 그중 실제로 바뀐 필드만 diff에 남아야
  // 승인자가 눈으로 바뀐 줄을 찾을 수 있다(미필터 시 "45,000,000 → 45,000,000" 도배).
  const TRIM_UPDATE_COMMON = {
    trimName: "520i",
    price: 50000000,
    modelYear: 2026,
    fuelType: "가솔린",
    driveSystem: "FWD",
    displacementCc: 1998,
    transmissionType: "A/T",
    bodyStyle: "세단",
    seatingCapacity: 5,
    status: "판매중",
    financialDiscountAmount: 1000000,
    partnerDiscountAmount: null,
    cashDiscountAmount: null,
  };

  it("trim.update — 13필드 payload에서 1필드만 다름 → 미변경 줄은 걸러지고 diff 1줄만 남는다", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: { ...TRIM_UPDATE_COMMON, price: 55000000 },
        snapshot: TRIM_UPDATE_COMMON,
      }),
    ).toEqual([{ label: "가격", before: "50,000,000", after: "55,000,000" }]);
  });

  it("trim.update — 13필드 전부 동일(null 필드 포함) → 빈 배열", () => {
    expect(
      buildChangeDiff({
        kind: "trim.update",
        payload: TRIM_UPDATE_COMMON,
        snapshot: TRIM_UPDATE_COMMON,
      }),
    ).toEqual([]);
  });

  it("option.update — type 값은 화면 라벨(기본 옵션/튜닝 옵션)로 표시", () => {
    expect(
      buildChangeDiff({
        kind: "option.update",
        payload: { type: "tuning" },
        snapshot: { type: "basic" },
      }),
    ).toEqual([{ label: "종류", before: "기본 옵션", after: "튜닝 옵션" }]);
  });
});

// 착지 경로 SSOT — 두 팝오버(대기열·내 요청)가 공유하는 URL 계약(brand 쿼리 필수·트림 hl 플래시·
// 신규 트림은 hlreq(요청 id) 마킹 — 트림이 아직 없어 hl을 못 쓴다, 2026-08-03).
describe("changeRequestDest", () => {
  const base = { id: "cr-1", kind: "trim.update" as const };

  it("브랜드 좌표가 없으면 null(삭제된 대상 — 갈 곳 없음)", () => {
    expect(changeRequestDest({ ...base, targetBrandId: null, targetModelId: 30, targetTrimId: 300 })).toBeNull();
  });

  it("모델이 없으면(model.create) 브랜드의 모델 목록으로", () => {
    expect(
      changeRequestDest({ ...base, kind: "model.create", targetBrandId: 3, targetModelId: null, targetTrimId: null }),
    ).toBe("/mc-master?brand=3");
  });

  it("트림까지 있으면 모델 뷰 + hl 플래시", () => {
    expect(changeRequestDest({ ...base, targetBrandId: 3, targetModelId: 30, targetTrimId: 300 })).toBe(
      "/mc-master/30?brand=3&hl=300",
    );
  });

  it("신규 트림(trim.create)은 hlreq=요청 id — 미리보기 행 마킹(그룹 펼침+플래시)", () => {
    expect(
      changeRequestDest({ id: "cr-9", kind: "trim.create", targetBrandId: 3, targetModelId: 30, targetTrimId: null }),
    ).toBe("/mc-master/30?brand=3&hlreq=cr-9");
  });

  it("트림 좌표도 hlreq 축도 아니면(model.update) 모델 뷰만", () => {
    expect(
      changeRequestDest({ ...base, kind: "model.update", targetBrandId: 3, targetModelId: 30, targetTrimId: null }),
    ).toBe("/mc-master/30?brand=3");
  });
});

// ── filterMyRequestVisible(자동 소멸, 2026-07-31 유슨생) — "지금 볼 것"만 남긴다:
// pending 전부 · rejected는 재요청 시 즉시/7일 후 숨김 · approved는 24시간 · canceled 숨김.
const NOW = new Date("2026-07-31T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function myRow(over: {
  status: string;
  kind?: ChangeRequestKind;
  targetId?: number | null;
  createdAt?: string;
  decidedAt?: string | null;
}) {
  return {
    status: over.status,
    kind: over.kind ?? ("trim.update" as ChangeRequestKind),
    targetId: over.targetId !== undefined ? over.targetId : 100,
    createdAt: over.createdAt ?? hoursAgo(1),
    decidedAt: over.decidedAt !== undefined ? over.decidedAt : null,
  };
}

it("filterMyRequestVisible: pending은 항상, canceled는 항상 숨김", () => {
  const rows = [myRow({ status: "pending", createdAt: hoursAgo(24 * 30) }), myRow({ status: "canceled" })];
  expect(filterMyRequestVisible(rows, NOW).map((r) => r.status)).toEqual(["pending"]);
});

it("filterMyRequestVisible: rejected는 같은 대상+작업의 재요청(pending)이 생기면 즉시 숨김", () => {
  const rejected = myRow({ status: "rejected", decidedAt: hoursAgo(1) });
  expect(filterMyRequestVisible([rejected], NOW)).toHaveLength(1); // 재요청 전엔 보인다
  const resubmitted = [myRow({ status: "pending" }), rejected]; // 같은 trim.update:100 재요청
  expect(filterMyRequestVisible(resubmitted, NOW).map((r) => r.status)).toEqual(["pending"]);
  // 다른 대상의 pending은 무관 — 반려는 그대로 보인다
  const other = [myRow({ status: "pending", targetId: 200 }), rejected];
  expect(filterMyRequestVisible(other, NOW)).toHaveLength(2);
});

it("filterMyRequestVisible: rejected는 반려 7일 뒤 자연 소멸(기준 = decidedAt, 없으면 createdAt)", () => {
  expect(filterMyRequestVisible([myRow({ status: "rejected", decidedAt: hoursAgo(24 * 6) })], NOW)).toHaveLength(1);
  expect(filterMyRequestVisible([myRow({ status: "rejected", decidedAt: hoursAgo(24 * 8) })], NOW)).toHaveLength(0);
  // decidedAt 없는 방어 폴백 — createdAt 기준
  expect(
    filterMyRequestVisible([myRow({ status: "rejected", createdAt: hoursAgo(24 * 8), decidedAt: null })], NOW),
  ).toHaveLength(0);
});

it("filterMyRequestVisible: approved는 24시간만(반영 확인 용도 — 결과는 카탈로그가 보여준다)", () => {
  expect(filterMyRequestVisible([myRow({ status: "approved", decidedAt: hoursAgo(23) })], NOW)).toHaveLength(1);
  expect(filterMyRequestVisible([myRow({ status: "approved", decidedAt: hoursAgo(25) })], NOW)).toHaveLength(0);
});

it("filterMyRequestVisible: create류 rejected(targetId null)는 재요청 매칭 불가 — 7일 창만 적용", () => {
  const rows = [
    myRow({ status: "pending", kind: "trim.create" as ChangeRequestKind, targetId: null }),
    myRow({ status: "rejected", kind: "trim.create" as ChangeRequestKind, targetId: null, decidedAt: hoursAgo(1) }),
  ];
  expect(filterMyRequestVisible(rows, NOW)).toHaveLength(2); // 새 create가 있어도 반려는 남는다
});

// 모델 목록 행 배지 집계(2026-08-05). 서버가 kind별로 좌표를 풀어 `targetModelId`를 채워 주므로
// 여기서는 그 값만 센다 — 어떤 kind가 어느 모델에 속하는지는 서버가 이미 판정했다.
describe("pendingCountByModel", () => {
  const row = (targetModelId: number | null) => ({ targetModelId }) as ChangeRequestItem;

  it("모델별로 센다 — kind가 섞여도 좌표가 같으면 한 모델로 모인다", () => {
    const counts = pendingCountByModel([row(42), row(42), row(401), row(42)]);
    expect(counts.get(42)).toBe(3);
    expect(counts.get(401)).toBe(1);
  });

  it("좌표가 없는 행은 뺀다 — 신규 모델·대상 소실은 목록의 어느 행에도 속하지 않는다", () => {
    const counts = pendingCountByModel([row(null), row(42), row(null)]);
    expect(counts.get(42)).toBe(1);
    expect(counts.size).toBe(1);
  });

  it("미로드(null)는 빈 맵 — 배지를 그리지 않는다(0으로 단정하지 않는다)", () => {
    expect(pendingCountByModel(null).size).toBe(0);
  });
});
