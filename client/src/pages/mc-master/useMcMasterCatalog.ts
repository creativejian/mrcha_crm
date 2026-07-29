import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type CatalogBrand,
  type CatalogModel,
  type CatalogTrim,
  type TrimColor,
  type TrimOptionSummary,
} from "@/lib/catalog";
import {
  fetchBrandsCached,
  fetchModelsCached,
  fetchOptionSummaryCached,
  fetchTrimColorsCached,
  fetchTrimsCached,
  getBrandIdForModel,
  getCachedBrands,
  getCachedModels,
  getCachedOptionSummary,
  getCachedTrimColors,
  getCachedTrims,
} from "./catalog-cache";
import { trimSubline } from "./trim-grouping";
import { mcMasterViewState } from "./view-state";

// 옵션 요약 행 → trimId 키 맵(트림 배지 조회용). 렌더 리셋·fetch 양쪽에서 공유.
const toOptionMap = (rows: TrimOptionSummary[]) => new Map(rows.map((r) => [r.trimId, r] as const));

// 트림 색상 행 → trimId별 배열 맵. 렌더 리셋·fetch 양쪽에서 공유.
function buildColorMap(rows: TrimColor[]): Map<number, TrimColor[]> {
  const map = new Map<number, TrimColor[]>();
  for (const c of rows) {
    if (c.trimId == null) continue;
    const arr = map.get(c.trimId) ?? [];
    arr.push(c);
    map.set(c.trimId, arr);
  }
  return map;
}

// 첫 등장 서브라인 그룹만 펼친 상태(모델 전환 시 초기화).
const firstGroup = (rows: CatalogTrim[]): Set<string> =>
  rows[0] ? new Set([trimSubline(rows[0].trimName)]) : new Set();

// 딜러 프로필 도착 전 스코프 센티널 — "브랜드 미확정이지만 URL·마지막 선택 폴백은 차단"을 뜻한다.
// 실존할 수 없는 id여야 하고(양수 금지 — 서버 idSchema가 positive라 fetch에 새면 400),
// 아래 models fetch가 이 값을 만나면 **요청 자체를 보내지 않는다**(2026-07-29 실기: 딜러 리로드마다
// -1 fetch → 400 → "불러오기 실패"가 스치던 원인).
export const SCOPE_BRAND_PENDING = -1;

// 차량 관리(/mc-master) 카탈로그 데이터 로딩/캐시. 라우팅(brandId/modelId)에 반응해
// 브랜드→모델→트림 뷰를 캐시 경유로 채운다(catalog-cache). 편집 직후 갱신은 reload*.
export function useMcMasterCatalog(
  modelId: string | undefined,
  urlBrandId: number | null,
  // 딜러 모드 브랜드 스코프(null = 제한 없음). brands 필터와 brandId 강제를 **한 곳에서** 처리한다
  // — 사이드바 표시 범위와 URL 우회 차단이 같은 값에서 나와야 어긋나지 않는다.
  scopeBrandId: number | null = null,
) {
  // 재진입 시 캐시값으로 즉시 초기화(brands 네트워크 대기 없이 사이드바 표시).
  const [brands, setBrands] = useState<CatalogBrand[]>(() => {
    const cached = getCachedBrands() ?? [];
    return scopeBrandId != null ? cached.filter((b) => b.id === scopeBrandId) : cached;
  });

  // 선택 브랜드는 상태가 아니라 파생값이다 — URL(?brand=)이 single source.
  // 폴백 순서: URL → 트림 뷰 모델의 브랜드(딥링크) → 마지막 선택(쿼리 없는 메뉴 재진입) → 첫 브랜드.
  const brandId = useMemo(() => {
    // 딜러 모드는 URL·딥링크·마지막 선택을 **전부 무시하고** 자기 브랜드로 고정한다.
    // 아래 `brands.length === 0` 분기(모델 fetch를 앞당기는 최적화)가 brands 도착 전에 손으로 고친
    // ?brand=를 검증 없이 통과시키므로, 그 창을 아예 만들지 않으려면 여기서 먼저 끊어야 한다.
    if (scopeBrandId != null) return scopeBrandId;
    const pick =
      urlBrandId ?? (modelId ? getBrandIdForModel(Number(modelId)) : undefined) ?? mcMasterViewState.brandId;
    // brands가 아직 없으면 검증 없이 그대로 쓴다 — 모델 fetch를 brands 왕복만큼 앞당긴다.
    // 도착 후 목록에 없는 id(구 북마크·손으로 고친 URL)면 첫 브랜드로 교정한다.
    if (pick != null && (brands.length === 0 || brands.some((b) => b.id === pick))) return pick;
    return brands[0]?.id ?? null;
  }, [urlBrandId, modelId, brands, scopeBrandId]);

  // 재진입 즉시 렌더(왕복 0) — 프리패치/직전 방문으로 캐시가 있으면 첫 페인트부터 목록이 있다.
  const [models, setModels] = useState<CatalogModel[]>(() =>
    brandId != null ? getCachedModels(brandId) ?? [] : [],
  );
  const [trims, setTrims] = useState<CatalogTrim[]>([]);
  const [colorsByTrim, setColorsByTrim] = useState<Map<number, TrimColor[]>>(new Map());
  const [optionByTrim, setOptionByTrim] = useState<Map<number, TrimOptionSummary>>(new Map());
  const [loadError, setLoadError] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // 선택(brandId/modelId)이 바뀌면 페인트 전 캐시값(or 빈값)으로 즉시 리셋해 이전 선택의
  // 잔상을 막는다 — 렌더 중 setState(React 'Adjusting state when a prop changes' 패턴).
  // 캐시(hover 프리패치)면 즉시 표시(왕복 0), 아니면 빈 화면 후 아래 effect의 fetch가 채운다.
  const [prevBrandId, setPrevBrandId] = useState(brandId);
  if (brandId !== prevBrandId) {
    setPrevBrandId(brandId);
    if (brandId != null) setModels(getCachedModels(brandId) ?? []);
  }
  const [prevModelId, setPrevModelId] = useState(modelId);
  if (modelId !== prevModelId) {
    setPrevModelId(modelId);
    if (modelId) {
      const id = Number(modelId);
      const ct = getCachedTrims(id) ?? [];
      setTrims(ct);
      setExpandedGroups(firstGroup(ct));
      setColorsByTrim(buildColorMap(getCachedTrimColors(id) ?? []));
      const co = getCachedOptionSummary(id);
      setOptionByTrim(co ? toOptionMap(co) : new Map());
    }
  }

  useEffect(() => {
    fetchBrandsCached()
      .then((b) => {
        // brandId는 brands에서 파생되므로 여기서 따로 세팅하지 않는다.
        // 딜러 모드면 사이드바에 자기 브랜드만 남도록 여기서 걸러 담는다(캐시 초기화와 같은 규칙).
        setBrands(scopeBrandId != null ? b.filter((x) => x.id === scopeBrandId) : b);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, [scopeBrandId]);

  useEffect(() => {
    // 센티널(딜러 프로필 대기)은 fetch 금지 — 프로필이 오면 실제 브랜드로 이 effect가 다시 돈다.
    if (brandId == null || brandId === SCOPE_BRAND_PENDING) return;
    let active = true;
    // hadCache면 갱신 실패해도 에러화면 대신 (위에서 세팅된) 캐시 유지.
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
    fetchTrimsCached(id)
      .then((rows) => {
        if (!active) return;
        setTrims(rows);
        setExpandedGroups(firstGroup(rows));
        setLoadError(false);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    fetchTrimColorsCached(id)
      .then((rows) => {
        if (active) setColorsByTrim(buildColorMap(rows));
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
  // 특정 그룹을 펼친 상태로 보장한다(접지 않는다) — ?hl= 딥링크가 접힌 서브라인 안의 트림을
  // 마킹할 때 쓴다. effect deps에 들어가므로 useCallback으로 정체성을 고정한다.
  const expandGroup = useCallback((key: string) => {
    setExpandedGroups((s) => (s.has(key) ? s : new Set(s).add(key)));
  }, []);

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
    models,
    setModels,
    trims,
    setTrims,
    colorsByTrim,
    optionByTrim,
    loadError,
    expandedGroups,
    toggleGroup,
    expandGroup,
    reloadModels,
    reloadTrims,
    reloadOptionSummary,
  };
}
