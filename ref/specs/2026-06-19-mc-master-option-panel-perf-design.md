# mc-master 옵션 패널 캐시 + 번쩍임 제거 설계

작성일: 2026-06-19
대상: 차량 관리(`/mc-master`) 국산차 트림의 옵션 패널(`OptionPanel`)
유형: perf + UX 버그픽스

## 배경 / 문제

국산차 트림 행의 옵션 배지를 클릭하면 옵션 상세 패널이 열린다. 현재 두 가지 문제가 있다.

1. **번쩍임** — 옵션 배지 클릭 시 `setOptionPanelTrim(trim)`으로 `OptionPanel`이 즉시 열리지만, 패널은 마운트 순간 `options=[]`·`loaded=false` 빈 상태다(`OptionPanel.tsx:36-42`). 데이터는 `useEffect`가 그린 뒤 `fetchOptions(trim.id)`로 받아오므로(`:48-63`), 응답 전 한 프레임 동안 빈 패널이 먼저 페인트된다. 로딩 인디케이터가 없어 다음이 잠깐 번쩍인다.
   - 탭 라벨이 `기본 옵션 (0) · 튜닝 옵션 (0)`로 표시(`:178, :188`).
   - 관리자(`canEdit`)일 때 `options.length === 0` 조건이 참이라 **「옵션 없음으로 확정」 토글 박스**가 떴다가(`:265-279`), 응답이 오면 사라지고 실제 리스트로 교체. ← 사용자가 본 잔상의 핵심.
2. **느림** — `OptionPanel`은 `fetchOptions(trim.id)`(= `GET /api/catalog/trims/{id}/options`)를 **캐시 없이 직접** 호출한다(`OptionPanel.tsx:50, :80` → `lib/catalog.ts:189`). `catalog-cache.ts`에는 brands·models·trims·trimColors·optionSummary(모델 단위 배지 요약) 캐시가 있지만 **트림 단위 옵션 상세용 캐시는 없다**. prod는 클릭마다 CF → Hyperdrive → DB(요청별 연결) 왕복이 1회 발생하고, 같은 트림을 두 번 열어도 매번 네트워크다(30초 신선도·dedupe·hover 프리패치 전부 미적용).

### 왜 이렇게 됐나
mc-master 캐시/프리패치 최적화(#48~#50)는 전부 `catalog-cache.ts` + `useMcMasterCatalog.ts`(트림 목록·모델 단위)만 다뤘고, `OptionPanel.tsx`(옵션 상세)는 #30 도입 당시의 "열 때마다 네트워크" 구조 그대로 남아 최적화 사각지대가 됐다.

## 목표

- 옵션 클릭 시 빈 패널/「옵션 없음 확정」 박스 번쩍임 제거.
- 옵션 상세를 캐시+프리패치해 재열람·프리패치된 트림은 즉시(왕복 0) 표시.
- 옵션 편집(추가/수정/삭제/noOption 토글) 후 상세·요약 캐시 정합성 유지.

비목표: 서버 측 Hyperdrive read 캐싱(보류 결정 유지), 옵션 관계(includes/excludes) 편집(Phase 2), 수입차/그룹뷰 레이아웃 변경.

## 설계

### B1 — 트림 단위 옵션 캐시 (`catalog-cache.ts`)

기존 제네릭 `makeCache<T>(fetcher)` 패턴을 그대로 재사용한다. fetcher는 `fetchOptions(trimId): Promise<OptionsBundle>`.

```ts
const optionsCache = makeCache<OptionsBundle>(fetchOptions);          // 키 = trimId

export const getCachedOptions = (trimId: number): OptionsBundle | undefined =>
  optionsCache.get(trimId);
export const fetchOptionsCached = (trimId: number, opts?: { force?: boolean }): Promise<OptionsBundle> =>
  optionsCache.load(trimId, opts);
export function prefetchOptions(trimId: number): void {
  void optionsCache.load(trimId).catch(() => undefined);
}
```

- `OptionsBundle`(`{options, relations}`)은 `@/lib/catalog`에서 이미 export됨(`catalog.ts:181`). `fetchOptions`도 동일 모듈에서 import.
- 30초 신선도(`FRESH_MS`)·inflight dedupe는 `makeCache` 공통이라 자동 상속.
- 모듈 스코프 캐시 → 패널 닫기/모델 전환 후에도 유지(재열람 즉시). 다른 모델·트림 단위 캐시와 동일 수명.

### A — `OptionPanel.tsx` 번쩍임 제거

1. **로드 교체 + 캐시 초기값**: `fetchOptions` → `fetchOptionsCached`로 교체. 초기 state를 동기 getter로 채운다.
   ```ts
   const cached = getCachedOptions(trim.id);
   const [options, setOptions] = useState<CatalogOption[]>(cached?.options ?? []);
   const [relations, setRelations] = useState<OptionRelation[]>(cached?.relations ?? []);
   const [loaded, setLoaded] = useState(cached != null);
   ```
   캐시 hit이면 첫 페인트부터 리스트·`loaded=true`(네트워크 0). `useEffect`는 그대로 두되 `fetchOptionsCached`를 호출(신선하면 즉시 resolve, stale이면 갱신 — SWR).
   - `MCMasterPage`에서 `<OptionPanel key={optionPanelTrim.id} ... />`로 trim별 재마운트를 보장한다. 그래야 trim 변경 시 `useState` 초기값(캐시 getter)이 재실행돼 이전 trim 옵션 잔상이 없다(#51 customer detail의 `key={customer.id}` 패턴과 동일).
2. **카운트 주입**: `MCMasterPage`가 `optionByTrim.get(trim.id)`의 `{basic, tuning}`을 `initialCounts?: { basic: number; tuning: number }` prop으로 전달. 탭 라벨은 `loaded`면 실제 `options` 기반 카운트, 로딩 중이면 `initialCounts`로 표시 → `(0)` 깜빡임 제거.
   - `TrimOptionSummary = { trimId, basic, tuning, noOption }`(`catalog.ts:183`)에 카운트 존재. `MCMasterPage`는 이미 `optionByTrim`을 보유.
3. **리스트 스켈레톤**: 캐시 miss·`loaded=false`일 때 리스트 영역에만 placeholder 행 표시. 행 수는 `initialCounts`의 현재 탭 카운트(없으면 소수 고정, 예: 2)만큼.
4. **`:265` 조건 보강**: `canEdit && options.length === 0` → `canEdit && loaded && options.length === 0`. 로딩 중 「옵션 없음 확정」 박스 숨김. (`:201` 「옵션이 없습니다」는 이미 `loaded &&` 포함 — 변경 없음.)

### 캐시 무효화 (정합성)

옵션 추가/수정/삭제/noOption 토글 후 `reload()`(`OptionPanel.tsx:79`)를 `fetchOptionsCached(trim.id, { force: true })`로 호출 → 상세 캐시 갱신. 기존 `onChanged()`(부모 `reloadOptionSummary` = 모델 요약 force 갱신, `MCMasterPage`)도 유지 → **상세·요약 두 캐시 동시 갱신**으로 배지·패널 모두 최신.

### hover 프리패치

`OptionBadgeButton`(`trim-cells.tsx`)에 `onPrefetch?: () => void` prop 추가. 호출부(`GroupedTrimTable`/`TrimTable`)가 `onMouseEnter`(또는 `onPointerEnter`)에 `prefetchOptions(t.id)`를 배선. 첫 클릭도 캐시 hit. 순수 표시 컴포넌트라 `catalog-cache`를 직접 import하지 않고 prop으로 주입한다(기존 모델 hover→프리패치 패턴과 동일 철학).

## 컴포넌트 / 데이터 흐름

```
[배지 hover] → onPrefetch → prefetchOptions(trimId) → optionsCache.load (background)
[배지 click] → setOptionPanelTrim(trim) → OptionPanel 마운트
                 ├─ getCachedOptions(trim.id) hit → 첫 페인트부터 리스트 (왕복 0)
                 └─ miss → initialCounts로 탭/스켈레톤 표시 → fetchOptionsCached → 리스트 채움
[옵션 편집] → reload(force:true) [상세 캐시] + onChanged → reloadOptionSummary(force) [요약 캐시]
```

## 변경 파일

| 파일 | 변경 |
|------|------|
| `client/src/pages/mc-master/catalog-cache.ts` | `optionsCache` + `getCachedOptions`/`fetchOptionsCached`/`prefetchOptions` export |
| `client/src/pages/mc-master/OptionPanel.tsx` | `fetchOptionsCached` 사용·캐시 초기값·`initialCounts` prop·스켈레톤·`:265` 보강 |
| `client/src/pages/mc-master/trim-cells.tsx` | `OptionBadgeButton`에 `onPrefetch?` prop |
| `client/src/pages/mc-master/GroupedTrimTable.tsx` | 배지 `onPrefetch` 전달 |
| `client/src/pages/mc-master/TrimTable.tsx` | 배지 `onPrefetch` 전달 |
| `client/src/pages/MCMasterPage.tsx` | `OptionPanel`에 `initialCounts`, 배지 `onPrefetch` 배선 |
| 테스트 | `OptionPanel` 동작(로딩→로드 전환, 카운트 주입, `:265`) + 캐시 export 동작 |

## 테스트 / 검증

- 단위: `OptionPanel` — (a) 캐시 hit 시 첫 렌더에 리스트·`loaded`, (b) 캐시 miss 시 `initialCounts` 카운트·스켈레톤, (c) 로딩 중 「옵션 없음 확정」 미표시. `catalog-cache` — 옵션 캐시 hit/miss/force(makeCache 공통이라 최소).
- 검증 4종: `bun run typecheck`(0) · `bun run lint`(0) · `bun run test:unit` · `bun run build`.
- 시각: mc-master 국산차 트림 옵션 패널 수동(로그인 필요 — 헤드리스 e2e는 JWKS 세션 필요).

## 리스크 / 캐비엇

- 옵션 편집 후 force 갱신을 빠뜨리면 30초간 stale. `reload`·`onChanged` 양쪽 force 필수.
- 캐시는 모듈 스코프라 장시간 세션에서 메모리에 누적되나, 트림 수가 제한적이고 기존 모델/트림 캐시와 동일 패턴이라 신규 리스크 아님.
- 서버 측 Hyperdrive read 캐싱은 보류 유지(`/api/catalog/*`는 읽기+쓰기 공용). 본 작업은 프런트 캐시만.
