# 견적 앱 발송 파이프라인 설계 (2026-07-05)

상태: 설계 확정(이사님 승인 3건 반영) · 구현 전
선행 슬라이스: 앱카드 4섹션 리디자인(#157) + 승격 갭(#158) — 발송 payload의 원천 데이터가 이 두 슬라이스로 완비됨.
쌍문서: `ref/2026-07-05-app-advisor-quotes-handoff.md` (앱 세션 인계문 — 마이그레이션 DDL·payload 계약·앱 UI 작업. **계약 변경 시 반드시 양쪽 함께 갱신**)

## 이사님 승인 (2026-07-05, 유슨생 전달)

1. **public 수신 테이블 신설 OK** — `public.advisor_quotes`. DDL은 앱 레포 `supabase/migrations/`에 작성·적용(앱 스키마 관할 원칙 유지, CRM 레포는 public DDL 불변).
2. **발송 시 `quote_requests.status → 'completed'` 전이 OK** — CHECK에 이미 존재하는 어휘(open/closed/completed), 앱 라벨 "완료".
3. **딜러 입찰(bids) 폐기 확정** — 단 테이블 DROP은 이번 범위 밖(0행·앱 코드 미사용 dormant, 삭제는 추후 앱 마이그레이션으로 별도).

## 배경 (조사 실측 2026-07-05)

- CRM "발송" = `crm.quotes.app_status/sent_at/valid_until` 내부 스탬프뿐. **앱이 읽을 경로 전무**(앱은 public만 읽고 crm 스키마 참조 0).
- 발송 스탬프 SSOT는 서버: 클라는 `appStatus:"sent"` 신호만, `sent_at`/`valid_until(+7일)`은 `src/db/queries/customer-quotes.ts` `headerSet()`이 확정. 발송 진입점 2곳(견적함 행 발송 `useQuoteList.sendQuoteToApp` · 워크벤치 `persistWorkbenchQuote({send})`)이 전부 `PATCH /quotes/:id` → `updateQuote()` 트랜잭션으로 수렴 — **write 훅 지점이 하나**.
- CRM 백엔드는 현재 public 테이블 write 0건(`src/db/public-app.ts` read 전용 명문화). 이번 슬라이스가 이사님 승인下에 write를 처음 연다.
- 앱 실태: 견적 상세 `quote_detail_screen.dart:202-233`에 "딜러 입찰 대기" 정적 스텁(교체 지정석), "내 견적함"은 AI견적서+견적요청 2섹션(상담사 견적 섹션 추가 자리), 푸시 인프라 전무(FCM 0), 고객 화면 Realtime 구독 없음(FutureProvider 재조회 기반).

## 아키텍처 (한 줄)

발송 트랜잭션 안에서 서버가 **앱카드 라벨 완성본을 조립해 `public.advisor_quotes`에 upsert** → 앱은 자기 행을 읽어 그대로 렌더(덤 렌더러) → 열람 시 앱이 `viewed_at` 스탬프 → CRM 견적함은 read-through로 열람 표시.

## 확정 결정

1. **수신 테이블 = `public.advisor_quotes`** (DDL 전문은 인계문): `user_id`(RLS 앵커, → profiles) · `quote_request_id` **nullable**(요청 무관 제안 견적 허용 — 수기 고객이 앱 연결된 경우) · `crm_quote_id` **UNIQUE**(crm.quotes.id loose id, FK 없음 — `source_quote_request_id`의 역방향 관례) · `quote_code`/`revision` · `vehicle_label`/`monthly_payment`(목록 카드용 정규 병기 — payload 파싱 없이 리스트 렌더) · `payload` jsonb · `sent_at`/`valid_until`/`viewed_at`.
2. **payload = 라벨 완성본 스냅샷(jsonb)**: `AppCardModel` 동형에서 **시간 종속 2필드 제외**(`statusLabel`→앱이 `viewed_at`로, `ddayLabel`→앱이 `valid_until`로 계산 — 스냅샷하면 "D-7" 박제 버그). `footerStampLabel`은 발송 시각 고정값이라 포함. `payloadVersion: 1` 키로 계약 진화 대비. **발송본 고정 철학**(#157 guidance 지역 스냅샷과 동일): CRM에서 견적을 고쳐도 보낸 카드는 불변, 이력은 CRM `revision`이 보유.
3. **재발송 = upsert(행 교체)**: `crm_quote_id` conflict 시 payload/정규 컬럼 전체 갱신 + `viewed_at` **NULL 리셋**(새 카드 = 다시 미확인). 같은 견적의 구버전이 앱에 쌓이지 않는다.
4. **서버 조립**: 발송 시점 DB 상태(crm.quotes + primary scenario + guidance)에서 서버가 조립 — 클라 조립본을 믿지 않음(`sent_at` 서버 스탬프와 같은 원칙). 조립 로직은 클라 `buildAppCardModel`(client/src/lib/app-card.ts)과 표시 파리티 필수 — 구현은 순수 조립부를 의존성 경량 모듈로 공유(assistant-history 선례) 또는 서버 재현+파리티 테스트, plan에서 확정.
5. **발송 게이트**: 고객에 `app_user_id` 없으면 advisor_quotes write 생략(현행 내부 스탬프 발송은 유지 — 기존 동작 불변). `user_id = crm.customers.app_user_id`.
6. **quote_requests 전이**: 발송 트랜잭션에서 `source_quote_request_id` 있으면 해당 요청 `status='completed'` UPDATE(멱등).
7. **CRM 견적 삭제 연동**: loose id라 CASCADE 없음 — `deleteQuote` 트랜잭션에서 `advisor_quotes` 행도 삭제(보낸 카드 회수). 미발송 견적은 행이 없어 no-op.
8. **viewed_at read-through**: CRM 견적함 열람 표시는 `advisor_quotes.viewed_at`을 조회 시 병합(같은 master DB, 조인 저렴). `crm.quotes.viewed_at` 컬럼으로의 동기화 배치는 두지 않는다(SSOT 하나).
9. **알림 없음(v1)**: 푸시 인프라 전무 — 앱은 재조회 기반. Realtime publication 추가는 후속(알림 슬라이스).

## 구현 범위 (CRM 레포 — 이 세션)

1. `src/db/public-app.ts`: `advisorQuotes` 테이블 정의 추가 + 파일 헤더의 "read 전용" 주석을 "advisor_quotes만 write 허용(이사님 승인 2026-07-05)"로 갱신.
2. 스냅샷 조립기(신규, TDD): crm.quotes 행 + primary scenario + guidance → payload jsonb. 클라 `buildAppCardModel`과 파리티 고정.
3. `updateQuote()` 발송 분기: appStatus "sent" 전이 시 같은 트랜잭션에서 ①advisor_quotes upsert ②quote_requests completed 전이. `deleteQuote()`에 회수 삭제.
4. 견적함 read-through: 고객 상세 조회에 viewed_at 병합 + 클라 열람 배지.
5. 서버 테스트(실 master, try/finally 원복): 발송→upsert 왕복·재발송 viewed_at 리셋·app_user_id 없음 생략·completed 전이·삭제 회수.

## 작업 분담·병렬 순서

| 순서 | 어디 | 무엇 |
|---|---|---|
| 1 (게이트) | 앱 세션 | 마이그레이션 작성·적용(테이블+RLS) — 인계문 DDL |
| 2 (병렬 A) | CRM 세션 | 조립기 TDD(게이트 전 착수 가능) → write/전이/read-through(테이블 생성 후 서버 테스트) |
| 2 (병렬 B) | 앱 세션 | Dart 모델/리포/견적함 섹션/상세 스텁 교체/열람 스탬프 |
| 3 | 양쪽 | 통합 스모크: CRM 발송 → 앱 표시 → 앱 열람 → CRM 열람 배지. 스모크 데이터 원복 |

## 범위 밖

- 견적 도착 알림(푸시/Realtime) — 후속 슬라이스(인프라 신설 필요).
- bids 테이블 DROP·Dart Bid 모델 삭제 — 폐기 확정됐으나 별도 정리.
- 견적 계산엔진 — 기존 보류 유지.
- `crm.quotes.app_status` "viewed" 자동 전이 — read-through로 대체(컬럼 정리는 후속 판단).

## 검증

- 조립기 유닛(TDD, 파리티 포함) + 서버 테스트 5종(위) + 검증 4종 + build.
- 통합 브라우저/앱 크로스 스모크(위 순서 3). 공유 master — 스모크 발송분 삭제 원복 필수.
