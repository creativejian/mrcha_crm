# CRM 리팩토링 배치 (2026-07-05 감사 → PR A~E)

> 감사 배경: #154~#162 머지 직후 4앵글 감사(서버 파이프라인·클라 앱카드/워크벤치·데이터화/dead CSS·크로스커팅 백로그 재평가).
> 정합성 회귀는 없었고, 버그 성격 5건 + 정리·구조 항목 다수. 이 문서는 5개 PR 묶음의 스코프 고정용.
> 실행: 유슨생 세션(0705-total-refactoring), 순서 A → B → C → D → E.

## PR A — 버그성 픽스 (브랜치 `refactor/crm-batch-a-workbench-residue-safari`)

### A-1. 워크벤치 카드 UI 상태 잔상 (데이터 오염 가능 — red 테스트 선행)

- 증상: 수정 진입(예: 보증금 percent·취득세 hybrid) → 닫기 → 신규/승격/초기화 → 이전 모드가 잔존.
  `extractWorkbenchScenarios`(useQuoteWorkbench.ts:694~698)와 persist payload(:782 acquisitionTaxMode)가
  이 state를 읽으므로 **저장까지 오염**. #158 `resetWorkbenchPricing()`이 가격만 잡고 모드 Record를 놓친 동류.
- 리셋 누락 매트릭스(수정 전 실측):
  - `openNewWorkbench`(:992): deposit/downPayment/residual/mileage 모드·mileageValues·discountLines·acquisitionTaxMode·primaryDiscountUnit 전부 누락
  - `openWorkbenchForQuoteRequest`(:121): residual/mileage 모드·mileageValues·discountLines·acquisitionTaxMode·primaryDiscountUnit 누락
  - `resetQuoteWorkbench`(:941): 위 전부 + deposit/downPayment 모드 + guidance 누락
  - `openEditQuote`(:1014): 모드는 시나리오에서 복원하지만 **acquisitionTaxMode 미복원**(잔상 state가 수정 저장에 실림 — dq.acquisitionTaxMode가 클라 타입에 이미 존재), discountLines·primaryDiscountUnit 잔존
- 픽스: 훅 내부 `clearCardUiState()` 헬퍼(모드 Record 5종+term+carTax+subsidy+discountLines+acquisitionTaxMode+primaryDiscountUnit 리셋)
  → 3개 오픈/리셋 경로 선두에서 호출(승격 시드는 그 뒤 덮어씀), openEditQuote는 clear 후 시나리오 복원 + `setAcquisitionTaxMode(dq?.acquisitionTaxMode ?? "normal")`.
  `resetQuoteWorkbench`는 guidance도 `seedGuidance()`로(입력값 초기화 의미론 — 행위 변경, PR 본문 명시).
- 테스트: `useQuoteWorkbench.residue.test.tsx` — renderHook(MemoryRouter, quoteList/detail 스텁 캐스팅, useCustomerDocuments.test.tsx 관례)로
  잔상 주입 → openNewWorkbench/resetQuoteWorkbench/openEditQuote → 클리어/복원 단언. 수정 전 red 확인.

### A-2. Safari controlled select 병행 바인딩 — 헬퍼 + 전수 적용

- 규칙(전역 CLAUDE.md): controlled select는 onChange+onInput 병행, 액션형은 ref 폴백. eb6fe7d가 7곳 고쳤지만 전수 감사 결과 **미적용 9곳 잔존**:
  - `QuoteWorkbench.tsx:461`(약정거리 — 저장값 영향), `CustomerDocuments.tsx:85`(문서종류 — 핵심 경로)
  - `CustomerManagementPage.tsx:791·795·799`(legacy 필터 3)
  - `mc-master/ModelEditPanel.tsx:43·54`, `mc-master/TrimEditPanel.tsx:71·100·110·124`(차량 관리 저장 폼)
- 픽스: `client/src/lib/select-bind.ts` 신설 — `bindSelect(value, commit)`(동일 핸들러 dual 바인딩 스프레드),
  `bindActionSelect(pendingRef, run)`(value 고정 액션형 ref 폴백). 유닛 테스트 동반(TDD).
  미적용 9곳 적용 + 기존 병행 지점 이관(QuoteWorkbench `bindGuidanceSelect` 내부·CustomerManagementPage:979 페이지크기·MoveTrimsDialog:38·ChatSessionHeader 액션형) → 규칙이 grep 가능한 단일 심볼로.
  uncontrolled(defaultValue) select(StatusFieldEditors·CustomerSchedules·NeedsDashboard·금융사:455)는 안전 — 불변.

### A-3. 할인 항목명 select 상태 미배선

- `QuoteWorkbench.tsx:376`이 `defaultValue`만 있어 `discountLines[].label`이 "재구매 할인" 고정(변경 유실) → 프리뷰 discountRowLabel 스테일.
- 픽스: 훅에 `setDiscountLineLabel(id, label)` 추가(+markQuoteDraftChanged) → `bindSelect`로 controlled 전환.
- **주의**: `crm.quotes.discount_lines`는 write 경로 자체가 없음(발송 payload 라벨 괴리) — 영속 vs 계약에서 라벨 제거는 **이사님 판단 대기**(이 PR 범위 밖, PR 본문 기록).

### 검증

typecheck 0 · lint 0 · test:unit(+신규) · build. 서버 무변경(test:server 무관). Safari 실기 확인은 머지 후 유슨생 실기(웹킷 재현 불가 특성).

## PR B — 서버 정비 (예정)

- `resolveGeminiTargetFromRequest(c)` 추출(gemini-target.ts) — 백로그 트리거 ② #162에서 충족(embed-on-write.ts:58~87이 2번째 호출자, env→target 인라인 복제). assistant.ts:83~90과 함께 소비. 백필 직결은 의도적 잔류.
- `holdStreamLifetime` → 내부 `holdWork` 위임(체인 통일, middleware/db.ts:35 덮어쓰기 제거 — 주석 규약의 코드화. 유일 호출처 prior hold 없어 행위 불변).
- `customer-quotes.ts:181` target 선택 → `pickPrimaryScenario` 1줄 치환(4번째 유사 패턴 해소).
- `advisor-quotes.ts:25~50` upsert insert/set 9필드 → 공통 스프레드 1벌화. `deleteQuote` pre-select(:276) → 회수 delete `.returning({quoteRequestId})`로 왕복 -1.
- `nextBusinessCode(prefix, ...)` 헬퍼 — nextQuoteCode/nextCustomerCode 동형 복제 해소 + **KST 환산 통일**(현행 로컬시간 YYMM은 CF Workers(UTC)에서 매월 1일 00~09시 KST 전월 채번).
- valid_until `7*86_400_000`(:107) 상수 명명. backfill cleanupOrphans를 main 선두로(throw 시 미실행 해소).
- (낮음, 여유 시) deleteQuote 회수/reopen에 발송 훅과 동일한 console.error 진단 로그.

## PR C — 마이그레이션 (예정)

- `crm.customer_{tasks,schedules,memos,documents}(customer_id, created_at)` 복합 인덱스 4개(목록 파생 서브쿼리 seq scan 해소).
- `customers.last_activity_at` drop + schema.ts:80 정의 제거(파생 alias `lastActivityAt`는 유지 — customers.ts:107·127).
- 경로: `db:generate` → `db:migrate`(schemaFilter crm), `db:push` 금지.

## PR D — viewed/라벨 표시 정리 (예정)

- appStatus "viewed" dead 분기 + 표시 모순(행 배지 "발송 완료" vs viewedBadge "고객 열람" 공존): `appStatus+viewedAt` 파생 단일 함수로 통합, `quoteAppSendLabel`≡`quoteAppStatusLabel` 중복 제거(quote-meta.ts:8~22), 서버 zod enum 축소는 신중 판단(app_status CHECK 실데이터 확인 후).
- `downPaymentRowLabelOf(purchaseMethod)` 헬퍼(quote-items.ts) — 3곳 인라인(app-card.ts:217·QuoteList.tsx:230·서버는 파리티 설계상 유지) 통합.
- `vehicleTitleOf` dedupe를 quote-items.ts로 이동 export — 미적용 3곳(quote-items.ts:219·QuoteList.tsx:152·useQuoteWorkbench.ts:187,770) 적용.
- `resolveUpdateBadge` 헬퍼(manage-status.ts) — 버킷 합성 3곳 산개(CustomerManagementPage:140·:587·useCustomerWorkflow.ts:52) 통합 + `FinalUpdateInfo.field` write-only 필드 제거.
- 소정리: 니즈 카드 버튼 핸들러 중복(NeedsDashboard:98·114), normalizeQuoteGuidance keyPoint+keyPoints 동시존재 테스트 1건, percent 빈값 blur "0" 복원, `maybachQuotePricingResult`→`initialQuotePricingResult` 리네임.

## PR E — dead CSS 일괄 정리 (예정)

- kim-* dead 후보 ~87종/~3,068줄(styles 17,510줄의 17.5%): workbench.css ~1,479줄(61%)·cards ~547·preview ~475·work ~246·needs ~137·shell ~91·workspace ~81·tasks ~12.
- #154 dead 2블록(cards.css:875 `.kim-app-card-status`·shell.css:611 `.kim-quote-attachment-*`) + #157 구 `.kim-app-*` 12종 포함.
- 콤마 병기 룰은 dead 셀렉터만 발라내기. 검증: 빌드 산출 CSS를 정리 전/후 비교 — 제거분 외 byte 동일 + 브라우저 스모크.
- 동적 클래스 조립(`kim-option-picker-dot--${n}` 등) 전수 재확인 후 삭제(오탐 방지). live `.kim-app-card-preview*` 4파일 분산은 preview.css 집결 검토.
- tools/customer-detail-screenshot.spec.ts가 `.kim-needs-method-badge`·`.kim-purchase-condition-item` 조준 — live 유지 대상.

## 기각(하지 않음)

파리티 테스트 3종 공용 헬퍼(과잉 추상화) · SOURCE SSOT 파리티 테스트(서버가 클라 상수 직접 import — 이미 원천 차단) ·
quote PATCH embed 키 게이트(hash skip으로 충분) · AppCardPreview 분해(불필요) · 백로그 트리거 ①③(미충족).

## 보류(판단 필요)

- `discount_lines` 영속 여부(발송 payload 할인 라벨 괴리) — 이사님.
- 클라↔서버 라벨 헬퍼 ~150줄 물리 공유(클라 번들에 src/ 유입 경계) — 팀 합의 후 별도 슬라이스.
- `quote-requests.ts:344` `source: "앱 견적요청"` 맨 리터럴 → named const(SSOT 그물 편입) — D에 흡수 가능.
