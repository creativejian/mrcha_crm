# 고객 상세 니즈 앱 카드 로딩 캐시화 + 프리패치 설계

작성일: 2026-06-30
상태: design 확정(브레인스토밍 승인). 다음 = writing-plans → 구현 → PR.
성격: 고객 상세 "고객의 니즈" 영역의 **앱 견적요청 카드**(`fetchCustomerQuoteRequests`) 로딩 지연을, 기존 `detailCache`/인박스 캐시 패턴을 미러링한 **고객별 캐시 + 행 hover 프리패치**로 해소.

## 배경 / 진단 (2026-06-29)

앱 유입 고객 상세의 니즈 카드는 `useCustomerNeeds` 훅이 마운트 후 `fetchCustomerQuoteRequests(detail.id)`로 **별도 fetch**한다(`appRequests` null→"불러오는 중"→카드). 이 fetch는:
- **캐시 없음** — 인박스 `fetchAppQuoteRequestsCached`·상세 `detailCache`와 달리 매 진입마다 새로 가져옴.
- **프리패치 없음** — 고객 행 hover로 미리 안 받음(상세 본체 `prefetchCustomerDetail`과 비대칭).
- 라우트 `GET /api/customers/:id/quote-requests`가 `getCustomerAppUserId`→`listQuoteRequestsByUser` **2왕복 순차** + 내부 batch.

→ CF/Hyperdrive RTT가 매 진입마다 발생해 카드가 늦게 뜬다.

## 결정 사항 (브레인스토밍 확정)

| 항목 | 결정 |
|---|---|
| 캐시 구조 | `detailCache`와 동형 — `Map<customerId, {value, at}>` + TTL 60s + inflight dedupe |
| 첫 로드 | 캐시 허용(`force=false`) → hover로 데워졌으면 즉시 |
| 승격 후 갱신 | `reloadAppRequests` = `force=true`(캐시 우회 + 갱신)로 배지 fresh |
| 행 hover 프리패치 | **앱 유입 고객만**(`customer.source === "앱 견적비교"`) — 수기 고객 빈-배열 왕복 낭비 방지 |
| 라우트 2→1왕복화 | **이번 범위 밖**(별도 follow-up) — 캐시+프리패치가 체감 지연을 직접 해소 |

## 아키텍처 / 컴포넌트

### 1. `client/src/lib/quote-requests.ts` — 고객별 캐시 (detailCache 미러)

- 모듈 스코프: `const NEEDS_TTL_MS = 60_000;` + `Map<string, {value: AppQuoteRequest[]; at: number}>`(캐시) + `Map<string, Promise<AppQuoteRequest[]>>`(inflight).
- `fetchCustomerQuoteRequestsCached(customerId: string, force = false): Promise<AppQuoteRequest[]>`
  - `!force && 캐시 신선(< TTL)` → 즉시 반환.
  - `!force && inflight` → 진행 중 promise 공유(dedupe).
  - 아니면 `fetchCustomerQuoteRequests(customerId)` 호출 → 성공 시 캐시 저장 → 반환. `.finally`로 inflight 정리.
- `prefetchCustomerQuoteRequests(customerId: string): void` — `void fetchCustomerQuoteRequestsCached(customerId).catch(() => {})`(백그라운드 워밍, 결과/에러 무시).
- `invalidateCustomerQuoteRequests(customerId: string): void` — `cache.delete(customerId)`(대칭용).
- 기존 `fetchCustomerQuoteRequests`(원본 fetch)는 **유지**(캐시 래퍼가 내부 호출). 외부 직접 호출은 캐시 버전으로 교체.

### 2. `client/src/components/customer-detail/hooks/useCustomerNeeds.ts` — 캐시 소비

- 첫 로드 effect: `fetchCustomerQuoteRequests(detail.id)` → `fetchCustomerQuoteRequestsCached(detail.id)`.
- `reloadAppRequests`: `fetchCustomerQuoteRequests(detail.id)` → `fetchCustomerQuoteRequestsCached(detail.id, true)`.
- 기존 cancel 가드/`setAppRequests` 흐름 그대로(캐시 hit이어도 Promise.resolve라 동일 경로).

### 3. `client/src/pages/CustomerManagementPage.tsx` — 행 hover 프리패치

- 행 `onMouseEnter`(현재 `prefetchCustomerDetail(customer.id)`, line ~596)에 추가:
  - `if (customer.source === "앱 견적비교") prefetchCustomerQuoteRequests(customer.id)`.
- import: `prefetchCustomerQuoteRequests` from `@/lib/quote-requests`.

## 데이터 흐름

1. 목록에서 앱 유입 고객 행 hover → `prefetchCustomerQuoteRequests` → 백그라운드 fetch → 캐시 저장.
2. 그 고객 상세 진입 → `useCustomerNeeds` effect → `fetchCustomerQuoteRequestsCached` → **캐시 hit → 즉시**.
3. 캐시 miss(hover 없이 바로 클릭) → fetch → 저장(다음 진입 즉시).
4. 견적 승격(워크벤치 INSERT, sourceQuoteRequestId) → `reloadAppRequests(force)` → fresh 카드(배지 갱신) + 캐시 갱신.

## 엣지 / 불변식

- TTL 60s: 타인 변경 등 외부 수정 흡수(detailCache와 동일 정책).
- 캐시 키 = customer uuid(`detail.id`). 고객별 격리.
- 수기 고객: 프리패치 안 함(source 게이트). 상세 진입 시 캐시 miss → fetch([]→캐시) → 다음 즉시. 회귀 없음.
- 앱 요청은 read-only(CRM 미수정) → 승격(promotedQuoteCount 변화) 외엔 무효화 불필요. 승격은 `reloadAppRequests(force)`로 처리.
- 캐시는 모듈 스코프(앱 생애주기). 새로고침 시 소멸(detailCache 동일).

## 검증

- `test:unit`: 캐시 단위테스트(인박스·detailCache 테스트 동형) — hit(왕복0)/dedupe(동시호출 1왕복)/force(우회+갱신)/TTL 만료 후 재fetch/prefetch가 캐시 채움.
- `typecheck`/`lint`/`build`.
- 수동(브라우저): 앱 고객 행 hover 후 상세 진입 = 카드 즉시 / 재진입 즉시 / 승격 후 배지 갱신 / 수기 고객 회귀 없음.

## 범위 밖 (follow-up)

- 라우트 2왕복→1왕복(백엔드 `getCustomerAppUserId`+`listQuoteRequestsByUser` 합치기).
- getCustomer 상세 fetch에 앱 요청 동봉(1왕복).
