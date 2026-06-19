import { useEffect, useState } from "react";

import {
  type CatalogBrand,
  type CatalogModel,
  type CatalogTrim,
  type TrimColor,
  type TrimOptionSummary,
  fetchBrands,
} from "@/lib/catalog";
import {
  fetchModelsCached,
  fetchOptionSummaryCached,
  fetchTrimColorsCached,
  fetchTrimsCached,
  getCachedModels,
} from "./catalog-cache";
import { trimSubline } from "./trim-grouping";

// 옵션 요약 행 → trimId 키 맵(트림 배지 조회용). effect·reload 양쪽에서 공유.
const toOptionMap = (rows: TrimOptionSummary[]) => new Map(rows.map((r) => [r.trimId, r] as const));

// 차량 관리(/mc-master) 카탈로그 데이터 로딩/캐시. 라우팅(modelId)에 반응해 브랜드→모델→
// 트림 뷰(트림/색상/옵션요약)를 캐시 경유로 채운다(catalog-cache). 편집 직후 갱신은 reload*.
export function useMcMasterCatalog(modelId: string | undefined) {
  const [brands, setBrands] = useState<CatalogBrand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [trims, setTrims] = useState<CatalogTrim[]>([]);
  const [colorsByTrim, setColorsByTrim] = useState<Map<number, TrimColor[]>>(new Map());
  const [optionByTrim, setOptionByTrim] = useState<Map<number, TrimOptionSummary>>(new Map());
  const [loadError, setLoadError] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchBrands()
      .then((b) => {
        setBrands(b);
        setBrandId((cur) => cur ?? b[0]?.id ?? null);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    if (brandId == null) return;
    let active = true;
    // 캐시/프리패치된 브랜드는 fetchModelsCached가 즉시 resolve → 사실상 즉시 페인트(왕복 0).
    // 아니면 fetch 후 캐시·이미지 워밍. hadCache면 갱신 실패해도 에러화면 대신 캐시 유지.
    const hadCache = getCachedModels(brandId) !== undefined;
    fetchModelsCached(brandId)
      .then((m) => {
        if (active) {
          setModels(m);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (active && !hadCache) setLoadError(true);
      });
    return () => {
      active = false; // 브랜드 빠르게 전환 시 늦게 도착한 응답이 다른 브랜드를 덮지 않게.
    };
  }, [brandId]);

  useEffect(() => {
    if (!modelId) return;
    const id = Number(modelId);
    let active = true; // 모델 빠르게 전환 시 늦게 온 응답이 다른 모델을 덮지 않게.
    // 캐시/프리패치된 모델은 즉시 resolve → 트림 뷰 진입 즉시.
    fetchTrimsCached(id)
      .then((rows) => {
        if (!active) return;
        setTrims(rows);
        // 첫 등장 서브라인 그룹만 펼친 상태로 진입(모델 전환 시 초기화).
        const first = rows[0] ? trimSubline(rows[0].trimName) : null;
        setExpandedGroups(first ? new Set([first]) : new Set());
        setLoadError(false);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    fetchTrimColorsCached(id)
      .then((rows) => {
        if (!active) return;
        const map = new Map<number, TrimColor[]>();
        for (const c of rows) {
          if (c.trimId == null) continue;
          const arr = map.get(c.trimId) ?? [];
          arr.push(c);
          map.set(c.trimId, arr);
        }
        setColorsByTrim(map);
      })
      .catch(() => undefined);
    fetchOptionSummaryCached(id)
      .then((rows) => {
        if (active) setOptionByTrim(toOptionMap(rows));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [modelId]);

  function reloadModels() {
    if (brandId == null) return;
    // 편집 직후엔 신선도 무시하고 새로 가져와 캐시까지 갱신.
    fetchModelsCached(brandId, { force: true })
      .then(setModels)
      .catch(() => setLoadError(true));
  }
  function reloadTrims() {
    if (!modelId) return;
    // 편집 직후엔 신선도 무시하고 새로 가져와 캐시까지 갱신.
    fetchTrimsCached(Number(modelId), { force: true })
      .then(setTrims)
      .catch(() => setLoadError(true));
  }
  function reloadOptionSummary() {
    if (!modelId) return;
    fetchOptionSummaryCached(Number(modelId), { force: true })
      .then((rows) => setOptionByTrim(toOptionMap(rows)))
      .catch(() => undefined);
  }
  function toggleGroup(key: string) {
    setExpandedGroups((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  return {
    brands,
    brandId,
    setBrandId,
    models,
    setModels,
    trims,
    setTrims,
    colorsByTrim,
    optionByTrim,
    loadError,
    expandedGroups,
    toggleGroup,
    reloadModels,
    reloadTrims,
    reloadOptionSummary,
  };
}
