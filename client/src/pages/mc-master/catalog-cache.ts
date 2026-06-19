import {
  type CatalogBrand,
  type CatalogModel,
  type CatalogTrim,
  type TrimColor,
  type TrimOptionSummary,
  fetchBrands,
  fetchModels,
  fetchOptionSummary,
  fetchTrimColors,
  fetchTrims,
} from "@/lib/catalog";

// 차량 관리(/mc-master) 카탈로그 프리패치/캐시.
//
// 목적: prod에서 클릭마다 CF→Hyperdrive→DB 왕복 + 요청별 연결 생성으로 랙이 생긴다
// (로컬은 웜 싱글톤이라 빠름). 모듈 스코프 캐시 + hover 프리패치로 재방문·프리패치된
// 항목은 즉시 렌더(왕복 0), 캐시는 화면 이동 후에도 유지. id별 신선도 30s, 편집은 force로 갱신.

const FRESH_MS = 30_000;

type CacheApi<T> = {
  get: (id: number) => T | undefined;
  load: (id: number, opts?: { force?: boolean }) => Promise<T>;
};

// id(brandId/modelId) → 값 캐시. 신선하면 네트워크 생략, 동시호출 dedupe, onLoad로 부수효과(이미지 워밍).
function makeCache<T>(fetcher: (id: number) => Promise<T>, onLoad?: (value: T, id: number) => void): CacheApi<T> {
  const cache = new Map<number, { value: T; at: number }>();
  const inflight = new Map<number, Promise<T>>();
  return {
    get: (id) => cache.get(id)?.value,
    load: (id, opts) => {
      const entry = cache.get(id);
      if (!opts?.force && entry && Date.now() - entry.at < FRESH_MS) return Promise.resolve(entry.value);
      const existing = inflight.get(id);
      if (existing) return existing;
      const p = fetcher(id)
        .then((value) => {
          cache.set(id, { value, at: Date.now() });
          onLoad?.(value, id);
          return value;
        })
        .finally(() => inflight.delete(id));
      inflight.set(id, p);
      return p;
    },
  };
}

// 모델 썸네일을 브라우저 캐시에 미리 올린다(render 엔드포인트 첫 변환 지연 흡수).
function warmModelImages(models: CatalogModel[]): void {
  if (typeof Image === "undefined") return;
  for (const m of models) {
    if (!m.imageUrl) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = m.imageUrl;
  }
}

// ── 브랜드 목록(거의 정적, 단일 리스트라 key 0 고정) ─────────────────────────────
// 캐시 없으면 mc-master 재진입마다 fetchBrands 네트워크(요청별 연결+Hyperdrive)로 블로킹된다.
const brandsCache = makeCache<CatalogBrand[]>(() => fetchBrands());
export const getCachedBrands = (): CatalogBrand[] | undefined => brandsCache.get(0);
export const fetchBrandsCached = (opts?: { force?: boolean }): Promise<CatalogBrand[]> => brandsCache.load(0, opts);

// ── 브랜드별 모델 목록 ──────────────────────────────────────────────────────────
// modelId → brandId 역인덱스: 트림 뷰 재진입 시 URL의 modelId로 브랜드를 복원한다(사이드바·isDomestic).
const modelBrandIndex = new Map<number, number>();
export const getBrandIdForModel = (modelId: number): number | undefined => modelBrandIndex.get(modelId);

const modelsCache = makeCache<CatalogModel[]>(fetchModels, (models, brandId) => {
  warmModelImages(models);
  for (const m of models) modelBrandIndex.set(m.id, brandId);
});
export const getCachedModels = (brandId: number): CatalogModel[] | undefined => modelsCache.get(brandId);
export const fetchModelsCached = (brandId: number, opts?: { force?: boolean }): Promise<CatalogModel[]> =>
  modelsCache.load(brandId, opts);
export function prefetchModels(brandId: number): void {
  void modelsCache.load(brandId).catch(() => undefined);
}

// ── 모델별 트림 뷰(트림 + 색상 + 옵션요약) ───────────────────────────────────────
const trimsCache = makeCache<CatalogTrim[]>(fetchTrims);
const trimColorsCache = makeCache<TrimColor[]>(fetchTrimColors);
const optionSummaryCache = makeCache<TrimOptionSummary[]>(fetchOptionSummary);

// 동기 캐시 getter — 모델 전환 시 페인트 전 즉시 표시해 이전 모델 트림 잔상을 막는다(useMcMasterCatalog).
export const getCachedTrims = (modelId: number): CatalogTrim[] | undefined => trimsCache.get(modelId);
export const getCachedTrimColors = (modelId: number): TrimColor[] | undefined => trimColorsCache.get(modelId);
export const getCachedOptionSummary = (modelId: number): TrimOptionSummary[] | undefined =>
  optionSummaryCache.get(modelId);

export const fetchTrimsCached = (modelId: number, opts?: { force?: boolean }): Promise<CatalogTrim[]> =>
  trimsCache.load(modelId, opts);
export const fetchTrimColorsCached = (modelId: number, opts?: { force?: boolean }): Promise<TrimColor[]> =>
  trimColorsCache.load(modelId, opts);
export const fetchOptionSummaryCached = (modelId: number, opts?: { force?: boolean }): Promise<TrimOptionSummary[]> =>
  optionSummaryCache.load(modelId, opts);

// 모델 hover/클릭 전 프리패치: 트림+색상+옵션요약을 한 번에 받아둬 트림 뷰 진입 즉시.
export function prefetchTrims(modelId: number): void {
  void trimsCache.load(modelId).catch(() => undefined);
  void trimColorsCache.load(modelId).catch(() => undefined);
  void optionSummaryCache.load(modelId).catch(() => undefined);
}
