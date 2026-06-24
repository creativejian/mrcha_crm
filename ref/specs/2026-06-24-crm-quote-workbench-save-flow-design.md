# 견적 워크벤치 저장/발송 흐름 재설계 — 설계

Date: 2026-06-24
Status: Draft (리뷰 대기)
Topic: 견적 워크벤치(솔루션 워크벤치)의 "작성완료/조건 저장/발송" 버튼 의미 재정의
공유 대상: 이사님 · 송실장 · 유슨생 (git 커밋으로 공유)

## 배경

견적 수정 워크벤치 일원화(#93~#98) 후, 워크벤치에 "저장/완료"처럼 보이는 버튼이 3개인데 **실제 DB 영속은 "수정 후 발송"(신규는 "견적함에 저장") 하나뿐**이다. 나머지("조건 저장"·"작성완료")는 프론트 state만 바꾸고 새로고침하면 사라진다.

유슨생이 "작성완료/조건 저장을 눌렀는데 리로드하면 변경이 사라진다"는 버그로 인식 → systematic-debugging 결과 **코드 로직은 정상, UX 함정**으로 확정. 핵심:

- **"작성완료"(`saveQuoteDetailDraft`)는 DB 저장이 아니다.** 실제 역할은 입력 검증 후 `isQuoteDraftSaved=true`로 `quoteDraftReady` 게이트를 열어 **견적서 보기·앱카드 보기·발송 버튼을 활성화**하는 프론트 게이트.
- 수정 모드에는 **"발송 없이 저장"이 없다**. 조건만 고치고 발송은 나중에 하고 싶어도 "수정 후 발송"밖에 없음.
- "재입력" 버튼(비교카드)은 `onClick`이 없는 **죽은 버튼**(편집은 "수정" 버튼).

## 결정 (합의: 추천 A)

1. **"작성완료" = 진짜 DB 저장 (발송 안 함).** 워크벤치에서 바꾼 **전부**(차량·옵션·색상·할인/가격·금융 시나리오)를 저장. `appStatus`는 기존 유지(미발송 = `draft` 또는 현재 상태). 신규는 첫 저장 시 INSERT(이후 같은 견적 UPDATE), 수정은 UPDATE.
2. **"수정 후 발송"(신규: "작성 후 발송") = 저장 + 발송.** 위 저장 + `appStatus="sent"` + 재발송(`bumpRevision`/`sentAt`).
3. **"조건 저장" = 비교카드 시나리오 슬롯 확정(프론트 유지).** DB 부분저장 안 함 — "작성완료/발송" 시 함께 DB 반영. 사용자가 "저장"으로 오해하지 않도록 명칭/토스트 명확화.
4. **"재입력" 죽은 버튼 제거.** (편집은 "수정" 버튼 = `editManualQuoteCondition`)
5. **미리보기(견적서/앱카드)는 "작성완료"(저장) 후 활성.** 저장된 견적을 미리보는 의미. `quoteDraftReady` 게이트는 유지하되, 그 게이트를 여는 "작성완료"가 이제 DB 저장을 동반.
6. **신규/수정 버튼 구조 일관**: 좌측 "작성완료"(저장) + 우측 "(작성/수정) 후 발송". 신규의 기존 "견적함에 저장"(INSERT draft)은 "작성완료"로 통합.

## 상세 설계

### 공통 저장 로직 추출

현재 `saveQuoteFromWorkbench`(저장+발송)의 입력 추출·낙관 갱신·API 호출 로직과, `saveQuoteDetailDraft`(검증만)를 합쳐 **하나의 영속 함수**로 정리한다.

- `persistWorkbenchQuote({ send: boolean })` (신규 헬퍼, `CustomerDetailPage.tsx`)
  - 입력 추출: 차량(`workbenchVehicle`/`trimDetail`), 옵션(`selectedWorkbenchOptionIds`), 색상(`exteriorColor`/`interiorColor`), 가격 DOM(`readPricingInputs`)+`pricing`, 시나리오(`extractWorkbenchScenarios`) — 기존 `saveQuoteFromWorkbench`와 동일.
  - 분기: `editingQuoteId`가 있으면 `apiUpdateQuote`(UPDATE), 없으면 `apiCreateQuote`(INSERT) 후 반환 id를 `editingQuoteId`로 세팅(이후 작성완료는 UPDATE).
  - `send=true`: `appStatus="sent"` + `bumpRevision` + 재발송 토스트.
  - `send=false`: `appStatus` 미변경(저장만). `isQuoteDraftSaved=true`·`isQuoteDraftDirty=false`로 게이트 열기.
  - 낙관 갱신(`setQuotes`) + 실패 롤백 + `invalidateCustomerDetail`(기존 패턴).

### 버튼 → 동작 매핑

| 버튼 | 동작 | 토스트 |
|------|------|--------|
| **작성완료** | `persistWorkbenchQuote({ send: false })` | "견적을 저장했습니다" |
| **(수정/작성) 후 발송** | `persistWorkbenchQuote({ send: true })` | "저장하고 고객 앱으로 발송했습니다" |
| **N번 조건 저장** | `saveManualQuoteCondition`(프론트 슬롯 확정, 그대로) | "N번 조건을 담았습니다" |
| 견적서/앱카드 보기 | `guardQuoteDraftOutput`(작성완료=저장 후 활성, 그대로) | 기존 |
| ~~재입력~~ | **제거** | — |

### `saveQuoteDetailDraft` / `saveQuoteFromWorkbench` 정리

- `saveQuoteDetailDraft`("작성완료") → `persistWorkbenchQuote({ send: false })`로 교체(검증은 함수 안에서).
- `saveQuoteFromWorkbench`("발송") → `persistWorkbenchQuote({ send: true })`로 교체.
- `guardQuoteDraftOutput`는 미리보기 버튼용으로 유지(작성완료 안 했으면 미리보기 막기). 단 "발송"은 자체적으로 검증 후 저장하므로, 발송 버튼은 작성완료 게이트와 독립(작성완료 안 해도 발송=저장+발송 가능하게). → 발송 버튼의 `guardQuoteDraftOutput` 호출 제거, 대신 `persistWorkbenchQuote` 내부 검증.

### 검증(`validateQuoteDetailDraft`)

저장/발송 시 차량 미선택 등 필수값 검증은 `persistWorkbenchQuote` 진입에서 수행(기존 `validateQuoteDetailDraft` 재사용). 실패 시 토스트 + 중단.

## 엣지케이스 / 리스크

- **신규 첫 작성완료 → INSERT → `editingQuoteId` 세팅**: 이후 작성완료/발송은 UPDATE. 같은 워크벤치 세션에서 중복 INSERT 방지.
- **낙관 id 가드**: 임시 id(`kim-`)는 API 생략(기존 패턴).
- **시나리오 0건**: `scenarios` 미전송(기존 보존, PR2c-2 가드 유지).
- **미리보기 게이트**: 작성완료(저장) 전 미리보기 막힘 → 사용자가 저장 먼저. (저장이 가벼우므로 허용)
- **상세 캐시 불변식**: 저장/발송 성공 시 `invalidateCustomerDetail` 필수.
- **발송 정책**: "발송 없이 저장"이 생기므로, 발송 여부가 명확해짐. 이사님 운영 정책 공유 필요(저장만 한 견적은 고객 앱 미노출).

## 비범위 (YAGNI)

- "조건 저장"마다 DB 부분저장(B안)은 안 함 — 작성완료가 전체 저장 시점.
- 미리보기 게이트를 "검증만으로(저장 전)" 여는 것은 안 함 — 저장 후 미리보기로 통일.
- 자동차세/보조금 시나리오 컬럼 노출은 별도(이전 spec 범위 밖).

## 검증 전략

- `bun run typecheck` 0 · `bun run lint` 0 · `bun run build` OK.
- `bun run test:server`(updateQuote/createQuote 회귀) · `bun run test:unit`.
- 브라우저 실측(카카오 세션, 배포본):
  - 수정 진입 → 약정거리/차량/옵션/색상 변경 → **"작성완료"** → 리로드 시 유지(발송 안 됨, appStatus 미변경).
  - **"수정 후 발송"** → 저장 + 발송(appStatus=sent) + 리로드 유지.
  - 신규 작성 → "작성완료"(INSERT) → 같은 세션 재"작성완료"(UPDATE, 중복 INSERT 없음).
  - "조건 저장"이 프론트 슬롯만(작성완료 전엔 DB 미반영) + 작성완료 시 함께 저장.
  - "재입력" 버튼 사라짐.

## 슬라이스

단일 PR로 충분(한 컴포넌트 내 흐름 정리). 커밋 단위: ①`persistWorkbenchQuote` 헬퍼 추출 + 두 버튼 wiring ②게이트/검증 정리 ③명칭·토스트·재입력 제거.
