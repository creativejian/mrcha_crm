# [차선생 CRM → 앱] 빠른 견적 V2 출고·추가요청 데이터 계약 — 회신·확정

작성 2026-07-24 · 원문: 앱 레포 `reference/design/quote-v2-delivery-crm-data-contract-proposal.md` (v3)
상태: **계약 확정** — D1~D6 전부 확정 · D5·D6 행위 변경 승인 완료(유슨생, 2026-07-24) · 잔여 = 앱 구현 착수 승인 1건

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

1. **미러 갱신** — `src/db/public-app.ts`의 `quoteRequests`에 신규 13컬럼. `text[]`는 `.array()`(첫 도입).
2. **라벨 SSOT 확장** — `client/src/data/quote-request-labels.ts`에 **+36개**(지역 16 · timing 6 · topic 6 · priority 8). 현 11개 → 47개. 앱 값정의서가 canonical이므로 `COLOR_PREFERENCE_MODE_LABEL` 주석과 같은 "임의 변경 금지" 규칙을 단다. 드리프트 가드 도입 여부는 그때 판단(`SOLUTION_LENDERS` 2겹 선례).
3. **지역 소비** — `payment_method` 분기(`installment`/`cash` → 등록 지역, 그 외 → 인수 지역). ⚠️ **null 케이스 테스트 필수**(V2부터 발생, 기존 데이터엔 없음).
4. **승격 시드** — `need_timing` 절대화(D3·D4 형식) + `need_delivery_method`(예약 해제 후). **빈 칸만 채우기**. `residence`는 시드하지 않는다.
5. **`customerRegion` 3단 폴백** — ⚠️ 앱카드 payload는 **서버·클라 2벌 조립기 + `app-card-payload-parity.test.ts`** 3곳을 함께 고쳐야 한다.
6. **AI 청크 반영** — 확정 문구로 **한 번에 묶어 1회 재백필**.

## 주의

- public 스키마 변경은 **앱 소유·앱 migration**. CRM은 미러만 갱신한다.
- `quote_request_options.price_at_request`는 NOT NULL이라 가격 미상이 `0`으로 저장된다 — CRM이 옵션가를 소비하기 시작하면 **"0 = 무료 아님"** 계약이 필요하다(현재는 개수만 소비 중이라 무해).
