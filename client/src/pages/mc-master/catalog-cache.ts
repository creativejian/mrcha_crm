import { type CatalogModel, fetchModels } from "@/lib/catalog";

// 차량 관리(/mc-master) 모델 목록 프리패치/캐시.
//
// 목적: prod에서 브랜드 클릭마다 CF→Hyperdrive→DB 왕복 + 요청별 연결 생성으로
// 클릭 랙이 생긴다(로컬은 웜 싱글톤이라 빠름). 모듈 스코프 캐시 + hover 프리패치로
// 재방문·프리패치된 브랜드는 즉시 렌더(왕복 0)하고, 캐시는 화면 이동 후에도 유지된다.

type Entry = { models: CatalogModel[]; at: number };

// 캐시가 이 시간보다 최신이면 네트워크 생략(즉시 반환). 어드민 편집은 force로 갱신한다.
const FRESH_MS = 30_000;

const cache = new Map<number, Entry>();
const inflight = new Map<number, Promise<CatalogModel[]>>();

// 즉시 렌더용(있으면 첫 페인트에 사용). 신선도 무관하게 마지막 스냅샷 반환.
export function getCachedModels(brandId: number): CatalogModel[] | undefined {
  return cache.get(brandId)?.models;
}

// 모델 목록을 가져온다. 캐시가 신선하면 네트워크 없이 반환, 아니면 fetch 후 캐시·이미지 워밍.
// 동시 호출은 brand별로 dedupe. force=true면 신선도 무시하고 항상 새로 가져온다(편집 후 갱신).
export function fetchModelsCached(brandId: number, opts?: { force?: boolean }): Promise<CatalogModel[]> {
  const entry = cache.get(brandId);
  if (!opts?.force && entry && Date.now() - entry.at < FRESH_MS) return Promise.resolve(entry.models);
  const existing = inflight.get(brandId);
  if (existing) return existing;
  const p = fetchModels(brandId)
    .then((models) => {
      cache.set(brandId, { models, at: Date.now() });
      warmModelImages(models);
      return models;
    })
    .finally(() => inflight.delete(brandId));
  inflight.set(brandId, p);
  return p;
}

// hover/focus 프리패치: 캐시만 채우고 결과는 버린다(에러 무시).
export function prefetchModels(brandId: number): void {
  void fetchModelsCached(brandId).catch(() => undefined);
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
