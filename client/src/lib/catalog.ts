import type { VehicleStatus } from "@/data/vehicle-taxonomy";
import { broadcastCatalogQueueChanged } from "./catalog-change-realtime";
import { getJson, sendJson, sendVoid } from "./http";

// ── 변경 승인 큐 202 공통 감지(PR3, 2026-07-30) ────────────────────────────────
// manager의 catalog 쓰기는 서버가 즉시 실행하지 않고 202 { queued, requestId }로 큐에 쌓는다
// (src/routes/catalog/change-request-kinds.ts submitChangeRequest). 큐 대상 8종 헬퍼는 아래
// sendCatalogWrite를 거쳐 queued 응답을 감지·알림한다 — 호출부는 성공 흐름을 그대로 타고
// (패널 닫힘·재조회 — catalog가 안 바뀌었으니 재조회는 무해한 no-op), 토스트·배지 갱신은
// 구독자(MCMasterPage·배지 훅)가 담당한다(spec §7.1 "호출부 개별 수술 없음").
// ⚠️ 유일한 예외 = OptionPanel 무옵션 토글: 재조회가 아니라 응답 후 로컬 플립이라, 그 호출부만
// isCatalogWriteQueued로 queued를 걸러 플립을 건너뛴다(반영 전인데 화면이 바뀌면 안 된다).
// 삭제·reorder·move·assign-codes는 admin 전용(202 불가)이라 sendJson 직행을 유지한다.
type CatalogWriteQueued = { queued: true; requestId: string };

export function isCatalogWriteQueued(value: unknown): value is CatalogWriteQueued {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { queued?: unknown }).queued === true &&
    typeof (value as { requestId?: unknown }).requestId === "string"
  );
}

const writeQueuedListeners = new Set<() => void>();
export function onCatalogWriteQueued(listener: () => void): () => void {
  writeQueuedListeners.add(listener);
  return () => {
    writeQueuedListeners.delete(listener);
  };
}

async function sendCatalogWrite<T>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T | CatalogWriteQueued> {
  const result = await sendJson<T | CatalogWriteQueued>(url, method, body);
  if (isCatalogWriteQueued(result)) {
    // 리스너 예외를 격리한다 — 큐 행은 이미 커밋된 뒤라, 여기서 던지면 성공 저장이 호출부
    // catch에서 거짓 실패(panelError)로 보이고 재시도는 409로 막히는 막다른 길이 된다.
    for (const l of writeQueuedListeners) {
      try {
        l();
      } catch {
        // 알림은 부가 효과 — 실패해도 저장 결과에 영향을 주지 않는다.
      }
    }
    broadcastCatalogQueueChanged(); // 타 세션(admin 대기열·배지)도 리로딩 없이 따라오게(신호 전용).
  }
  return result;
}

// ── 차량 관리(admin) ───────────────────────────────────────────────────────────
export type CatalogBrand = {
  id: number;
  name: string;
  logoUrl: string | null;
  isDomestic: boolean;
  isPopular: boolean;
  sortOrder: number;
  brandCode: number | null;
};

export type CatalogModel = {
  id: number;
  name: string;
  category: string | null;
  status: VehicleStatus;
  sortOrder: number | null;
  modelCode: number | null;
  imageUrl: string | null;
  trimCount: number;
  minPrice: number | null;
  maxPrice: number | null;
};

export async function fetchBrands(): Promise<CatalogBrand[]> {
  return getJson("/api/catalog/brands");
}

export async function fetchModels(brandId: number): Promise<CatalogModel[]> {
  return getJson(`/api/catalog/models?brandId=${brandId}`);
}

export async function createModel(input: {
  brandId: number;
  name: string;
  category: string | null;
  status: VehicleStatus;
}): Promise<CatalogModel | CatalogWriteQueued> {
  return sendCatalogWrite("/api/catalog/models", "POST", input);
}

export async function updateModel(
  id: number,
  input: { category?: string | null; status?: VehicleStatus },
): Promise<CatalogModel | CatalogWriteQueued> {
  return sendCatalogWrite(`/api/catalog/models/${id}`, "PATCH", input);
}

export async function deleteModel(id: number): Promise<{ id: number }> {
  return sendJson(`/api/catalog/models/${id}`, "DELETE");
}

// ── 트림 ───────────────────────────────────────────────────────────────────────
export type CatalogTrim = {
  id: number;
  name: string;
  trimName: string;
  canonicalName: string | null;
  price: number;
  modelYear: number | null;
  fuelType: string | null;
  driveSystem: string | null;
  displacementCc: number | null;
  transmissionType: string | null;
  bodyStyle: string | null;
  seatingCapacity: number | null;
  status: VehicleStatus;
  mcCode: string | null;
  sortOrder: number | null;
  priceUpdatedAt: string | null;
  financialDiscountAmount: number | null;
  partnerDiscountAmount: number | null;
  cashDiscountAmount: number | null;
  discountUpdatedAt: string | null;
};

export type TrimColor = {
  trimId: number | null;
  colorType: string;
  name: string;
  hexValue: string | null;
};

export type TrimInput = {
  trimName: string;
  price: number;
  modelYear: number;
  fuelType: string;
  driveSystem?: string | null;
  displacementCc?: number | null;
  transmissionType?: string | null;
  bodyStyle?: string | null;
  seatingCapacity?: number | null;
  status?: VehicleStatus;
  financialDiscountAmount?: number | null;
  partnerDiscountAmount?: number | null;
  cashDiscountAmount?: number | null;
};

export async function fetchTrims(modelId: number): Promise<CatalogTrim[]> {
  return getJson(`/api/catalog/trims?modelId=${modelId}`);
}

export async function fetchTrimColors(modelId: number): Promise<TrimColor[]> {
  return getJson(`/api/catalog/models/${modelId}/trim-colors`);
}

export async function createTrim(modelId: number, input: TrimInput): Promise<CatalogTrim | CatalogWriteQueued> {
  return sendCatalogWrite("/api/catalog/trims", "POST", { modelId, ...input });
}

export async function updateTrim(id: number, input: Partial<TrimInput>): Promise<CatalogTrim | CatalogWriteQueued> {
  return sendCatalogWrite(`/api/catalog/trims/${id}`, "PATCH", input);
}

export async function deleteTrim(id: number): Promise<{ id: number }> {
  return sendJson(`/api/catalog/trims/${id}`, "DELETE");
}

// 내 pending trim.create "이어서 수정"(2026-08-03) — 새 요청 적재가 아니라 payload 통째 교체.
// 202 { queued } 동형 응답이라 sendCatalogWrite의 공통 감지(토스트·배지 재조회·broadcast)를
// 그대로 탄다. modelId = 원 요청의 부모 좌표(서버도 부모 키를 원 요청 값으로 고정하는 이중 방어).
export async function replaceTrimChangeRequest(
  requestId: string,
  modelId: number,
  input: TrimInput,
): Promise<CatalogWriteQueued | unknown> {
  return sendCatalogWrite(`/api/catalog/change-requests/${requestId}`, "PUT", { modelId, ...input });
}

// 모델의 mc_code 미부여 트림에 고유번호 일괄 부여.
export async function assignMcCodes(modelId: number): Promise<{ assigned: number }> {
  return sendJson(`/api/catalog/models/${modelId}/assign-codes`, "POST");
}

// ── 옵션 ───────────────────────────────────────────────────────────────────────
export type OptionType = "basic" | "tuning";
export type CatalogOption = { id: number; type: OptionType; name: string; price: number | null };
// 옵션 관계(includes/excludes) — 표식 표시용(읽기 전용).
export type OptionRelation = { optionId: number; relatedOptionId: number; type: "includes" | "excludes" };
export type OptionsBundle = { options: CatalogOption[]; relations: OptionRelation[] };
// 트림 행 배지용 요약: 기본/튜닝 개수 + 무옵션 확정.
export type TrimOptionSummary = { trimId: number; basic: number; tuning: number; noOption: boolean };

export async function fetchOptionSummary(modelId: number): Promise<TrimOptionSummary[]> {
  return getJson(`/api/catalog/models/${modelId}/option-summary`);
}

export async function fetchOptions(trimId: number): Promise<OptionsBundle> {
  return getJson(`/api/catalog/trims/${trimId}/options`);
}

export async function createOption(
  trimId: number,
  input: { type: OptionType; name: string; price: number | null },
): Promise<CatalogOption | CatalogWriteQueued> {
  return sendCatalogWrite(`/api/catalog/trims/${trimId}/options`, "POST", input);
}

export async function updateOption(
  id: number,
  input: { name?: string; price?: number | null },
): Promise<CatalogOption | CatalogWriteQueued> {
  return sendCatalogWrite(`/api/catalog/options/${id}`, "PATCH", input);
}

export async function deleteOption(id: number): Promise<{ id: number }> {
  return sendJson(`/api/catalog/options/${id}`, "DELETE");
}

export async function setNoOption(trimId: number): Promise<{ ok: boolean } | CatalogWriteQueued> {
  return sendCatalogWrite(`/api/catalog/trims/${trimId}/no-option`, "POST");
}

export async function unsetNoOption(trimId: number): Promise<{ ok: boolean } | CatalogWriteQueued> {
  return sendCatalogWrite(`/api/catalog/trims/${trimId}/no-option`, "DELETE");
}

// 순서변경: orderedIds 위치(1..N) = sort_order.
export async function reorderModels(ids: number[]): Promise<void> {
  await sendVoid("/api/catalog/models/reorder", "POST", { ids });
}

export async function reorderTrims(ids: number[]): Promise<void> {
  await sendVoid("/api/catalog/trims/reorder", "POST", { ids });
}

// 트림 다른 모델로 이동(같은 브랜드).
export async function moveTrims(trimIds: number[], targetModelId: number): Promise<{ moved: number }> {
  return sendJson("/api/catalog/trims/move", "POST", { trimIds, targetModelId });
}
