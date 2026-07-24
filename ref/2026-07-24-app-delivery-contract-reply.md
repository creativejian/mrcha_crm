# [차선생 CRM → 앱] 빠른 견적 V2 출고·추가요청 데이터 계약 — 회신·확정

작성 2026-07-24 · 원문: 앱 레포 `reference/design/quote-v2-delivery-crm-data-contract-proposal.md` (v3)
상태: **계약 확정 · CRM Phase 2 5/7 구현·머지·실기 완료**(`#340`~`#343`) — D1~D6 확정 · D5·D6 승인 완료(유슨생) · 잔여 = Phase 2-6(AI 청크 재백필)·2-7(인박스 컬럼)은 데이터 축적/샘플 후 · 앱 구현 착수 승인 1건

## 결론

앱 빠른 견적 V2의 출고·추가요청 13필드가 **현재 제출 시 전부 버려진다**(`public.quote_requests` 대응 컬럼 0개 · RPC 인자 0개 — 실측). 저장을 시작하는 계약을 앱과 공동 확정했다.

**핵심 합의 = 카디널리티 하이브리드.** 요청당 스냅샷은 `quote_requests` 신규 컬럼에 저장하고, CRM 고객 필드(고객당 1벌)는 **승격 시 수렴**한다.

| 근거 (양쪽 실측) | 값 |
|---|---|
| 앱은 요청마다 새로 묻는다 | 제출 시 `finally { reset() }` → `QuoteDeliveryDetailsDraft.empty()`. 로컬 영속화·프로필 프리필 **0** |
| 요청은 고객당 다수 | 제임스 **95건** / 13 / 4 / 1 |
| CRM은 고객당 1벌 | `residence`·`need_timing`·`need_delivery_method` 각 1칸, `customer_deliveries` **customer_id UNIQUE** |
| 견적당 "출고" 칸은 의미가 다름 | `quotes.delivery`=탁송료 **금액** · `scenarios.dueAtDelivery`=출고 전 납입 **금액** · `guidance.deliveryComment`/`expectedDelivery`=**상담사→고객 안내 문구**(방향 반대) |

## CRM이 제공한 정정·논점 (전부 계약에 반영됨)

**정정 2건**
1. `need_delivery_method` CHECK는 4값이 아니라 **5값** — `탁송 요청 / 매장 출고 / 직접 수령 / 협의 필요 / 확인 필요`. 5번째는 `PURCHASE_UNSET_SENTINEL`(미입력 센티넬). 앱 3값과 매핑되고 **"직접 수령"은 앱에 대응 없음**.
2. `registration_region_mode`의 `same_as_delivery`는 "예약"이 아니라 **구조적으로 저장 불가** — renderer가 항상 `different`를 스탬프하고 `fromPayload`도 `same_as_delivery`를 `different`로 재스탬프한다(앱 코드 실측).

**CRM 고유 논점 4건**
- 🔴 **임베딩 전량 재백필** — 견적요청·고객은 업무 AI 청크로 임베딩된다(`buildQuoteRequestChunkText` · 고객 청크 `labeled("구매시기", needTiming)`). 출고 필드를 청크에 넣거나 `need_timing` 시드를 시작하면 content 변경 → `embeddingContentHash` 전량 갱신. **문구 형식(D3·D4)은 확정 후 변경 금지**, 청크 반영은 묶어서 **1회 재백필**로 끝낸다.
- 두 지역 동시 존재 시 소비 규칙 부재 → `payment_method` 분기로 계약화(§5-4).
- 거주지 파생 `guidance.customerRegion`과 앱 지역의 화면 병존 → D6으로 승격·확정.
- 희망(`delivery_timing_*`) ≠ 실적(`customer_deliveries.delivered_date`) — 이름이 비슷해 계약에 명시.

**추가 3건**(v3 반영): 과거 월 시드는 정상 동작 명시 · `payment_method` null은 V2부터 생기는 새 경로(기존 113건 전부 non-null) · 앱 어휘 변경 시 CRM 사전 통보.

## 확정 사항 D1~D6

| # | 확정 | 요지 |
|---|---|---|
| D1 | `text 'YYYY-MM'` + CHECK | 월 단위 의사표시에 `date`는 거짓 정밀도(1일). 사전순=시간순이라 정렬 무해. CRM `date`는 실적 전용이라 타입 차이가 희망/실적 혼동을 막는다 |
| D2 | `text[]` | 구조체 아닌 단순 코드 목록(CRM `jsonb` 선례는 전부 구조체). ⚠️ CRM drizzle 미러에 **배열 첫 도입**(DB 전체 선례 1개뿐) |
| D3 | 절대화 문구, 앵커 병기 안 함 | 원 답변은 `quote_requests`에 보존돼 복원 가능. `need_timing`은 수기 덮어쓰기 운영 필드 + AI 청크 텍스트라 짧을수록 좋다 |
| D4 | 마감형 `"YYYY년 M월까지"` | 기간형("이내")은 상대 표현이 남아 절대화 취지 훼손 |
| D5 | **빈 칸만 채우기(비파괴)** | 현행 `createCustomerFromRequest`는 기존 고객이면 무갱신(`quote-requests.ts:373`). 자동 시드가 상담사 수기 입력을 지우면 안 된다. 🟡 행위 변경 — **승인 완료** |
| D6 | `customerRegion` **3단 폴백으로 소스 교체** — 앱 지역 → 거주지 파생 → `"확인 필요"` | 실측이 질문을 바꿨다: `customerRegion`은 저장값을 무시하고 **항상 거주지에서 재파생**하는 단일 소스 구조(`useQuoteWorkbench.ts:1649`)라 "우선순위" 개념이 없다. 소비처는 고객에게 나가는 앱카드 "고객 지역"(`AppCardPreview.tsx:76`). 탁송료·등록비가 붙는 곳은 거주지가 아니라 인수/등록 지역. 🟡 고객 노출 문구 변경 — **승인 완료** |

## CRM Phase 2 작업 목록 (앱 Phase 1 이후 착수)

1. ✅ **미러 갱신** — `src/db/public-app.ts`의 `quoteRequests`에 신규 13컬럼. 배열 2종은 `.array().notNull().default(sql\`'{}'::text[]\`)` — default 표기가 없으면 INSERT 필수가 되어 기존 픽스처가 전부 깨진다.
2. ✅ **라벨 SSOT 확장** — ⚠️ **실측으로 +36개가 아니라 +6개였다**(`REQUEST_TOPIC_LABEL`만). 지역 16은 앱이 `*_region_name` 정식명 스냅샷을 보내 해석표가 필요 없고, timing 6은 절대화 텍스트(`deliveryTimingTextOf`)에 흡수되며, priority 8·`delivery_method` 3은 예약 필드라 값이 안 온다. 토픽 라벨은 앱 `quote_v2_renderer.dart` 실측(뒤 3종은 제안서 괄호가 라벨이 아니라 **적용 조건**이었다 — `joint_ownership`=공동명의 검토 · `transfer_terms`=승계 조건 확인).
3. ✅ **지역 소비** — `deliveryRegionOf`(`client/src/lib/quote-delivery.ts`, 순수 모듈 = 서버 공용)가 `payment_method`로 분기. null 케이스 테스트 포함.
4. ✅ **승격 시드**(`#341`) — `createCustomerFromRequest`·`linkRequestToCustomer`에 **빈 칸만 채우기**(UPDATE WHERE로 비파괴, 동시 승격에도 원자적). `need_delivery_method`는 예약(앱 `delivery_method` 미노출). `residence`는 시드하지 않는다.
5. ✅ **`customerRegion` 3단 폴백**(`#342`) — 앱 지역 → 거주지 파생 → "확인 필요". ⚠️ **회신 당시 "조립기 3곳 동시 수정"이라 적었으나 실측으로 틀렸다** — 조립기(`app-card.ts`)는 저장된 `guidance.customerRegion`을 옮길 뿐 재파생하지 않아 **고칠 곳은 파생 1곳**(`customerRegionOf` + 워크벤치 `seedGuidance`). 파리티 테스트 무변경. **범위는 승격 작성 경로만** — 기존 견적 수정 진입은 `sourceQuoteRequestId`를 버리는 현 설계라 거주지 폴백 유지(되살리면 요청 재연결·completed 전이에 영향, 별건).
6. **AI 청크 반영** — 확정 문구로 **한 번에 묶어 1회 재백필**. (남음, 데이터 축적 후)
7. **인박스 테이블 출고 컬럼** — 고객 상세 카드(`NeedsDashboard`)는 붙였으나 인박스(`AppRequestsPage`)는 **테이블이라 컬럼 추가 = 레이아웃 변경**이다. 실데이터가 0건인 상태에서 폭을 정하면 다시 손봐야 해 **샘플 확인 후**로 미뤘다. (남음)

## 실기 관측 (2026-07-24 · 유슨생 · 첫 V2 요청 유입)

첫 V2 요청(리스·인천·`within_three_months`)으로 컬러·지역·시기·D6 폴백 **전 경로 정상 확인**. 강남구로 뜨던 건 **Safari 구 번들 캐시**였고(코드·API·번들 3중 실측 후 `bun dev` 재시작으로 인천 확인) 구현 결함 아님.

- **🔵 앱 `specific_month`(특정 월 지정) UI 미노출** — 앱 출고 시기 선택지가 4개뿐(`이번 달`/`다음 달`/`3개월 이내`/`미정`, `quote_v2_renderer.dart:4189~`). `specificMonth`는 options 배열에 없으나 **특정 월 피커 렌더 로직(4202)은 준비돼 있다** = 앱이 진입 버튼만 아직 안 붙였다. **CRM은 대응 완료** — DB CHECK 6값·`deliveryTimingTextOf`의 `specific_month`→`target_month` 처리·테스트 전부 있어 앱이 켜면 **무변경 수용**(예약 필드 `delivery_method`·`quote_priority_codes`와 같은 성격). 의도된 미출시인지 앱 버그인지는 앱팀 판단(이사님 공유).
- **선재 버그 1건 발견·수정**(`#343`) — `deposit_type='none'`(무보증, 앱 07-17 도입) 라벨 누락으로 raw "none" 노출. V2 출고와 별개.

## 주의

## 주의

- public 스키마 변경은 **앱 소유·앱 migration**. CRM은 미러만 갱신한다.
- `quote_request_options.price_at_request`는 NOT NULL이라 가격 미상이 `0`으로 저장된다 — CRM이 옵션가를 소비하기 시작하면 **"0 = 무료 아님"** 계약이 필요하다(현재는 개수만 소비 중이라 무해).
