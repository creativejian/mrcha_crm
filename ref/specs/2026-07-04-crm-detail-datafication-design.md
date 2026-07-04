# 고객 상세 데이터화 마감 + kim 리네임 설계 (2026-07-04)

상태: 설계 확정(유슨생 승인) · 구현 전
브랜치 전략: 한 슬라이스, **2 PR 분할** — PR1(mock→DB 마감) 머지 후 PR2(kim 리네임) 착수

## 배경 · 컨펌 기록

- **이사님 "점진 일반화" 컨펌 완료**(유슨생 전달, 2026-07-04). 기존 brief·메모리의 "컨펌 대기(선행 조건)" 표기는 이 문서로 해소.
- **중요 발견(2026-07-04 코드 실태 조사)**: "김민준 시범→전체표준" 레이아웃 일반화는 **#118~#122에서 이미 완료**돼 있었다. `CustomerDetailPage.tsx`에 김민준 분기가 없고 전 고객이 동일 레이아웃, 구 레이아웃 코드도 부재. 메모·할일·일정·서류·구매조건·니즈·견적함·진행상태 전부 실 DB CRUD.
- 따라서 이 슬라이스의 실제 범위 = **잔여 mock 4곳의 DB화/제거(PR1) + kim 심볼 리네임(PR2)**. 원래 상상하던 "레이아웃 대체 + 대규모 데이터화"가 아님.

## 실태 조사 요약 (설계 전제 실측)

| 항목 | 실측 결과 |
|---|---|
| 잔여 mock | ①상담 타임라인(고객 필드 합성 4행) ②관리 상태(`initialFinalUpdateByCustomerId` mock 맵, `client/src/lib/customer-table.ts:30` — 목록·상세 공용) ③"디엘(견적서)" 가짜 첨부 버튼(`status-meta.ts` `kimMockQuoteAttachments`) ④워크벤치 미리보기 `D-6`/`미확인 견적` 하드코딩 배지(`KimAppCardPreview.tsx`) |
| `crm.consultations` | **0행 · 쓰기 경로 전무**(read만 존재). 백엔드 `getCustomer`는 이미 조회해 응답 포함하는데 프론트 타입(`client/src/lib/customers.ts`)이 버림. 컬럼 = channel/summary/status/occurred_at/advisor_id |
| `customers.last_activity_at` | 죽은 컬럼 — 20/22행에 시드값만 있고 갱신 경로 없음 |
| `customers.updated_at` | **살아있는 신호** — `updateCustomer` PATCH마다 스탬프(`src/db/queries/customers.ts:63`) |
| 자식 CRUD | 메모/할일/일정/서류 mutation은 `customers.updated_at`을 건드리지 않음 → "마지막 담당자 액션"은 자식 테이블 timestamp까지 봐야 함 |
| kim 심볼 | 대부분 "이름만 kim인 범용 유틸"(lib/kim-*.ts 6종·메타 상수·타입). 진짜 김민준 mock 데이터 심볼은 위 mock 4곳 관련뿐 |

## 확정 결정 (브레인스토밍 Q&A)

1. **범위**: 한 슬라이스, 2 PR 분할(기능 변경과 대량 리네임 diff 분리 — 리뷰 가능성).
2. **관리 상태**: 파생 계산. **읽기 시 SQL 파생**(쓰기 touch 스탬프 ❌, 프론트 단독 계산 ❌ — 목록/상세 불일치).
3. **타임라인**: 하이브리드 병합(합성 행 유지 + consultations 시간순 병합). 상담 기록 쓰기 UI는 별도 슬라이스.
4. **장식 mock 2곳**: 둘 다 제거(대응 기능 미구현 — 기능 슬라이스에서 실데이터로 부활).
5. **리네임 범위**: TS 심볼+파일명만. **kim-* CSS 클래스는 보류**(시각 회귀 리스크 0 유지, 필요 시 별도 기계 치환 PR).

## PR1 — mock→DB 마감

### ① 관리 상태 파생

- **서버**: 목록·상세 조회 쿼리에 파생 필드 — `GREATEST(customers.updated_at, max(자식 created_at))`, 자식 = customer_memos·customer_tasks·customer_schedules·customer_documents. **(구현 조사 보정: 자식 4테이블엔 updated_at 컬럼이 없음 — 자식 추가는 잡히고 자식 수정은 못 잡는 허용 근사. 자식 updated_at 컬럼 추가는 follow-up.)** 응답의 기존 `lastActivityAt` 자리를 파생값으로 대체(의미 재정의를 코드 주석으로 명시). `last_activity_at` 컬럼 자체는 불변·미사용 — drop은 follow-up.
- **프론트**: `client/src/lib/manage-status.ts` 신설, 순수 bucketing 함수(TDD). 규칙(현행 문서 기준 그대로):
  - `recontacted=true` → `재문의` (기간 무관)
  - `statusGroup=신규 && status=상담접수` → 공백(액션 전)
  - 경과일(= now − 파생 `lastActivityAt`, 일 단위): 0~6 `정상` / 7~14 `확인필요` / 15~29 `지연` / 30+ `장기방치`
- **배선**: 상세 `useCustomerWorkflow.resolveKimManageStatus`의 mock 조회 교체 + 목록 관리 상태 컬럼 동일 lib 소비. `initialFinalUpdateByCustomerId` mock 맵 **삭제**. 수정 직후 "방금 전" 낙관 표시(`markRecentUpdate`/in-memory override)는 현행 유지 — 베이스 데이터만 mock→파생.

### ② 타임라인 하이브리드

- `CustomerDetailResponse`에 `consultations` 추가(id/channel/summary/status/occurredAt/advisorId/createdAt) — 백엔드 무변경(이미 반환).
- `timelineRows`: 합성 행(접수/배정/상태/메모) 유지 + consultations 행(channel·summary·occurred_at 표시) 시간순 병합. 0행이면 현행 렌더와 동일 = 기존 화면 무변화.

### ③ 장식 mock 제거

- `kimMockQuoteAttachments` 상수 + `StatusWorkflow.tsx` 첨부 버튼 렌더 제거.
- `KimAppCardPreview` `D-6`/`미확인 견적` 배지 제거(제거 후 미리보기 헤더 레이아웃 브라우저 확인 1회).

### 테스트 · 검증 (PR1)

- bucketing 유닛(TDD — 경계값 6/7·14/15·29/30일, 재문의 우선순위, 공백 조건) + 타임라인 병합 순수 헬퍼 유닛.
- 파생 SQL은 `bun run test:server`(실 master DB) 백엔드 테스트.
- 검증 4종 + build + 브라우저 스모크: 김민준 + 앱 유입 고객 각 1명(관리 상태 표시·타임라인·mock 부재) + 목록 관리 상태 컬럼.

## PR2 — kim 리네임 (기능 무변경)

### 명명 규칙

| 현재 | 변경 |
|---|---|
| `KimMinjunDetailContent` | `CustomerDetailContent` |
| `KimAppCardPreview`(+파일) | `AppCardPreview` |
| `lib/kim-detail-utils.ts` | `lib/detail-utils.ts` |
| `lib/kim-status-fields.ts` | `lib/status-fields.ts` |
| `lib/kim-schedule.ts` | `lib/schedule-items.ts` |
| `lib/kim-popover-frames.ts` | `lib/popover-frames.ts` |
| `lib/kim-quote.ts` | `lib/quote-items.ts` |
| `lib/kim-app-card.ts` | `lib/app-card.ts` |
| `formatKim*` / `parseKim*` / `kim*Options` | `format*` / `parse*` / `*Options` (충돌 시 `customer` 접두, typecheck 판정) |
| `KimQuoteItem` / `toKimQuoteItem` | `QuoteItem` / `toQuoteItem` (충돌 확인 후) |
| `kimMinjunStatusFieldMeta` / `kimMinjunWorkflowMeta` / `kimMinjunPurchaseFields` | `statusFieldMeta` / `workflowMeta` / `purchaseFieldScaffold` |
| `kimMaybachQuotePricingMock` / `kimManualQuoteConditionCards` | `emptyQuotePricing` / `emptyQuoteConditionCards` (실체=빈 기본값) |
| `KimOpenEditor` / `kimEditorMatches` | `OpenEditor` / `editorMatches` |
| 파일 상단 "김민준 전용" 주석 | 범용 서술로 갱신 |

### 불가침

`kim-*` CSS 클래스 전부, `data/customers.ts` 옵션 SSOT(스키마 CHECK 공유), `data/prototype.ts`, `QuotesPage.tsx` "김민준" 목업 문자열, 대시보드/파이낸스/Topbar 목업.

### 실행 · 검증 (PR2)

- 심볼 단위 word-boundary 치환 → 파일 rename(git rename 감지 유지: 이동과 내용 수정 커밋 분리) → 매 단계 typecheck로 잔여 참조 강제 검출. 테스트 파일 import 동반 갱신.
- typecheck 0 · lint 0 · unit/server 전량 green · build + 상세 열기 스모크 1회.

## 범위 밖 / Follow-up

- `customers.last_activity_at` 컬럼 drop(마이그레이션) — 파생 안정화 후.
- 상담 기록(consultations) 쓰기 CRUD — 별도 기능 슬라이스.
- `kim-*` CSS 클래스 리네임 — 필요 재부상 시 별도 기계 치환 PR(#141 byte-diff 방법론).
- 견적서 첨부 팝업·견적 발송 상태/만료(D-day) — 해당 기능 슬라이스에서 실데이터로.
- 목록 `initialCustomers` 목업(`data/customers.ts`)과 대시보드/파이낸스 목업 — 이 슬라이스 무관.
