import { describe, expect, it } from "vitest";

import type { ChangeRequestItem } from "@/lib/catalog-change-requests";
import { pendingTrimCellPatch, splitModelPending } from "./pending-preview";

// 모델 단위 pending 3분류(행 배지 · 신규 트림 미리보기 · 헤더 pill)의 순수 로직 잠금.
// payload는 서버 zod 파싱 출력이라 실전에선 정상값이지만, 표시 전용 합성이 비정상 값에도
// 죽지 않아야 한다(라벨 합성 labelTargets의 NaN 방어와 같은 결).

const BASE: ChangeRequestItem = {
  id: "cr-1",
  kind: "trim.update",
  targetType: "trim",
  targetId: 100,
  payload: { price: 50000000 },
  snapshot: { price: 45000000 },
  status: "pending",
  requestedBy: "user-1",
  rejectReason: null,
  createdAt: "2026-08-03T00:00:00.000Z",
  decidedAt: null,
  targetLabel: "캐스퍼 › 스마트",
  targetBrandId: 1,
  targetModelId: 10,
  targetTrimId: 100,
};

const CREATE: ChangeRequestItem = {
  ...BASE,
  id: "cr-c1",
  kind: "trim.create",
  targetId: null,
  targetTrimId: null,
  payload: {
    modelId: 10,
    trimName: "27년형 가솔린 1.0 - 스마트",
    price: 15460000,
    modelYear: 2027,
    fuelType: "가솔린",
    driveSystem: "FWD",
    status: "판매중",
  },
  snapshot: {},
};

describe("splitModelPending", () => {
  it("targetTrimId 있는 요청은 트림별 Map에 누적된다(같은 트림 다건 순서 유지)", () => {
    const second = { ...BASE, id: "cr-2", kind: "trim.no-option.set" as const, payload: {} };
    const { byTrim, previews, headerRequests } = splitModelPending([BASE, second]);
    expect(byTrim.get(100)?.map((r) => r.id)).toEqual(["cr-1", "cr-2"]);
    expect(previews).toEqual([]);
    expect(headerRequests).toEqual([]);
  });

  it("trim.create는 미리보기로 합성된다 — payload 필드 매핑 + 음수 고유 id", () => {
    const { byTrim, previews, headerRequests } = splitModelPending([CREATE]);
    expect(byTrim.size).toBe(0);
    expect(headerRequests).toEqual([]);
    expect(previews).toHaveLength(1);
    const t = previews[0]!.trim;
    expect(previews[0]!.request.id).toBe("cr-c1");
    expect(t.id).toBeLessThan(0); // 실제 트림 id(양수)와 충돌 금지
    expect(t.trimName).toBe("27년형 가솔린 1.0 - 스마트");
    expect(t.price).toBe(15460000);
    expect(t.modelYear).toBe(2027);
    expect(t.fuelType).toBe("가솔린");
    expect(t.status).toBe("판매중");
    expect(t.mcCode).toBeNull(); // 미승인 — 고유번호·정렬·할인 전부 빈 값
    expect(t.financialDiscountAmount).toBeNull();
  });

  it("미리보기 여러 건이면 합성 id가 서로 다르다", () => {
    const { previews } = splitModelPending([CREATE, { ...CREATE, id: "cr-c2" }]);
    expect(new Set(previews.map((p) => p.trim.id)).size).toBe(2);
  });

  it("payload.status가 없으면 판매중 폴백(DB default와 동일)", () => {
    const { previews } = splitModelPending([{ ...CREATE, payload: { ...CREATE.payload, status: undefined } }]);
    expect(previews[0]!.trim.status).toBe("판매중");
  });

  it("비정상 payload(숫자 아님·누락)에도 죽지 않는다 — price 0·나머지 null 폴백", () => {
    const { previews } = splitModelPending([{ ...CREATE, payload: { trimName: 123, price: "abc" } }]);
    const t = previews[0]!.trim;
    expect(t.trimName).toBe("123"); // String() 강제 — 표시 전용
    expect(t.price).toBe(0);
    expect(t.modelYear).toBeNull();
    expect(t.fuelType).toBeNull();
  });

  it("트림 행에 못 붙는 나머지(model.update 등)는 헤더로 간다", () => {
    const modelUpdate: ChangeRequestItem = {
      ...BASE,
      id: "cr-m",
      kind: "model.update",
      targetType: "model",
      targetId: 10,
      targetTrimId: null,
      payload: { status: "단종" },
      snapshot: { status: "판매중" },
    };
    const { byTrim, previews, headerRequests } = splitModelPending([modelUpdate]);
    expect(byTrim.size).toBe(0);
    expect(previews).toEqual([]);
    expect(headerRequests.map((r) => r.id)).toEqual(["cr-m"]);
  });
});

// 셀 인라인 diff — 테이블 컬럼이 있는 4종만, 실제로 바뀐 필드만 patch 키가 생긴다.
describe("pendingTrimCellPatch", () => {
  it("trim.update의 바뀐 필드(4종 축)만 담는다 — 미변경·컬럼 없는 필드 제외", () => {
    const update: ChangeRequestItem = {
      ...BASE,
      payload: { trimName: "새 이름", price: 43480000, modelYear: 2026, status: "판매중", fuelType: "디젤" },
      snapshot: { trimName: "옛 이름", price: 43530000, modelYear: 2026, status: "판매중", fuelType: "가솔린" },
    };
    // modelYear·status 미변경 → 키 없음 · fuelType은 컬럼이 없어 축 밖.
    expect(pendingTrimCellPatch([update])).toEqual({ trimName: "새 이름", price: 43480000 });
  });

  it("update가 없거나(무옵션 토글만) 바뀐 셀 필드가 없으면 null", () => {
    expect(pendingTrimCellPatch(undefined)).toBeNull();
    expect(pendingTrimCellPatch([{ ...BASE, kind: "trim.no-option.set", payload: {}, snapshot: {} }])).toBeNull();
    expect(
      pendingTrimCellPatch([{ ...BASE, payload: { price: 100, fuelType: "디젤" }, snapshot: { price: 100, fuelType: "가솔린" } }]),
    ).toBeNull();
  });

  it("숫자 필드는 number로 강제 — 비정상 값은 키를 만들지 않는다", () => {
    expect(pendingTrimCellPatch([{ ...BASE, payload: { price: "abc" }, snapshot: { price: 1 } }])).toBeNull();
  });
});
