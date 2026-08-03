import type { VehicleStatus } from "@/data/vehicle-taxonomy";
import type { CatalogTrim } from "@/lib/catalog";
import type { ChangeRequestItem } from "@/lib/catalog-change-requests";

// 모델 단위 pending 3분류(spec §7.2 확장, 2026-08-03):
//  - targetTrimId 있는 요청(트림 수정·무옵션·옵션류) → 그 트림 행의 배지(byTrim)
//  - trim.create → 트림 테이블 안 "미리보기 행"(previews — 텍스트 요약만으로는 추가된 게
//    안 보인다는 이사님 지적의 해소. payload를 CatalogTrim 모양으로 합성해 기존 행 셀을 재사용)
//  - 나머지(model.update 등 붙을 행이 없는 것) → 트림 뷰 헤더 pill(headerRequests)
// payload는 서버 zod 파싱 출력이라 정상값이 전제지만, 표시 전용 합성이라 비정상 값에도
// 죽지 않게 폴백한다(labelTargets의 NaN 방어와 같은 결).

export type PendingTrimPreview = { request: ChangeRequestItem; trim: CatalogTrim };

export type ModelPendingSplit = {
  byTrim: Map<number, ChangeRequestItem[]>;
  previews: PendingTrimPreview[];
  headerRequests: ChangeRequestItem[];
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return typeof v !== "boolean" && v != null && v !== "" && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));

// 합성 id는 음수(순번 기반) — 실제 트림 id(양수)와 충돌하지 않아 colorsByTrim 등 Map 조회가
// 자연스럽게 miss(색상 없음)로 떨어진다. React key는 request.id(uuid)를 쓴다.
function previewTrim(request: ChangeRequestItem, seq: number): CatalogTrim {
  const p = request.payload;
  const trimName = str(p.trimName) ?? "";
  return {
    id: -(seq + 1),
    name: trimName,
    trimName,
    canonicalName: null,
    price: num(p.price) ?? 0,
    modelYear: num(p.modelYear),
    fuelType: str(p.fuelType),
    driveSystem: str(p.driveSystem),
    displacementCc: num(p.displacementCc),
    transmissionType: str(p.transmissionType),
    bodyStyle: str(p.bodyStyle),
    seatingCapacity: num(p.seatingCapacity),
    // trimBody.status는 optional — 비면 DB default(판매중)와 같은 값으로 보여준다.
    status: (str(p.status) as VehicleStatus | null) ?? "판매중",
    mcCode: null,
    sortOrder: null,
    priceUpdatedAt: null,
    financialDiscountAmount: null,
    partnerDiscountAmount: null,
    cashDiscountAmount: null,
    discountUpdatedAt: null,
  };
}

export function splitModelPending(rows: ChangeRequestItem[]): ModelPendingSplit {
  const byTrim = new Map<number, ChangeRequestItem[]>();
  const previews: PendingTrimPreview[] = [];
  const headerRequests: ChangeRequestItem[] = [];
  for (const r of rows) {
    if (r.targetTrimId != null) {
      const arr = byTrim.get(r.targetTrimId) ?? [];
      arr.push(r);
      byTrim.set(r.targetTrimId, arr);
    } else if (r.kind === "trim.create") {
      previews.push({ request: r, trim: previewTrim(r, previews.length) });
    } else {
      headerRequests.push(r);
    }
  }
  return { byTrim, previews, headerRequests };
}
