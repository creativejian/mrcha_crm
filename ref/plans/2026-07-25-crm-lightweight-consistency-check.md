# CRM 경량 정합성 체크 (2026-07-25 착수 계획)

> **풀 감사가 아니다.** 배치 15(2026-07-22)를 마지막으로 풀 감사 관례는 폐지됐다
> (`AGENTS.md`「리팩토링 배치 감사 — 트리거 기반·경량」). 이 문서는 **경량 기본형**
> — 2앵글(정합성·회귀그물) + 실측 렌즈 1개 — 의 착수 계획이자 판정 기록 자리다.

## 왜 지금인가 (트리거 판정)

| 트리거 | 판정 |
|---|---|
| ⓐ 실데이터 변형 | **애매하게 걸림** — 승격·연결이 니즈 7필드를 덮어쓴다(`#357`·`#358`). 단 `applyFeaturedRequestNeeds`는 07-24 `#349`에 이미 있던 로직이고 **새 변형 규칙은 0건** |
| ⓑ 외부 계약 | **아님** — `public.profiles`·`quote_requests` 읽기만, 앱 계약 무변경 |
| ⓒ 검증 없이 머지 | **아님** — 07-25 머지 6건 전부 7단계 CI + `test:server` 697 통과 |

→ **풀 감사는 과하다.** 그런데 경량 체크는 값어치가 있다. 근거는 오늘 실제로 나온 두 건:

1. **`#357`에서 승격 경로를 빠뜨렸다** → `#358`로 보완. 네 경로(link/create × request/consultation)
   대칭은 맞췄지만 **같은 종류의 누락이 다른 축에 또 있을 수 있다.**
2. **`test:server` 선재 실패 2건이 CI 밖에서 조용히 쌓여 있었다.** 정렬 없는 `limit(1)`이 어제 생긴
   고객을 집으면서 CHECK에 거부됐다 — 코드가 안 변해도 **공유 master 데이터가 변하면 깨지는** 자리이고,
   `test:server`는 CI에 없어(공유 DB·운영 알림) 아무도 안 보고 있다.

## 앵글 (2개)

### A1 — 정합성: "한쪽만 고친 짝"이 더 있는가

오늘 드러난 결함 3건이 전부 **같은 성격**이었다: 같은 일을 하는 경로가 여럿인데 일부만 고쳐진 것.

- `linkRequestToCustomer` ✅ / `linkConsultationToCustomer` ❌ (`#357`에서 해소)
- `createCustomerFromRequest` ✅ / `createCustomerFromConsultation` ❌ (`#358`에서 해소)
- 서버 PATCH 409는 `featured_request_id` / 화면은 `app_user_id` (`#357`에서 해소)

**찾을 것** — 아래 세 유형의 비대칭:
1. **경로 대칭** — 요청/상담, link/create, 승격/연결처럼 짝이 있는 함수에서 한쪽만 부르는 헬퍼
2. **판정 축 일치** — 서버 게이트와 클라 UI가 **다른 컬럼·다른 조건**으로 같은 판정을 하는 곳
   (오늘 `featured_request_id` vs `app_user_id`가 그 사례. 견적 쓰기·배정·인박스 게이트도 같은 축인지)
3. **표시 전용 상수의 스테일** — 코드 규칙에서 유도한 표시 문구가 규칙 변경을 따라가지 않는 곳
   (`ROLE_ACCESS_SUMMARY`가 대표 사례 — 도구가 못 잡는다고 주석에 명시해 뒀다)

### A2 — 회귀 그물: `test:server` 사각지대

`test:server`는 CI에 없다(공유 master DB에 붙어 운영 알림까지 발사 — 의도된 제외).
그래서 **로컬에서 안 돌리면 영구히 안 돌아가고**, 실패가 쌓여도 아무도 모른다.

**찾을 것**:
1. **데이터 의존 픽스처** — 정렬 없는 `limit(1)`, `[0]` 인덱싱, "아무 행이나" 집는 패턴.
   오늘 `routes/quote-requests.test.ts` 2건이 이걸로 깨졌다. 같은 관용구가 몇 군데 더 있는지.
2. **계약 위반을 부르는 픽스처** — DB CHECK·유니크를 건드리는 세팅
   (`customers_phone_app_exclusive_check`처럼 조건부 제약).
3. **CI에 있어야 하는데 없는 검증** — `test:server` 케이스 중 실 DB가 필요 없는 것이 섞여 있으면
   유닛으로 옮겨 CI 그물에 넣을 수 있다.

## 실측 렌즈 (1개)

**승격·연결 4경로를 실 DB로 1회 재현**한다. 코드 읽기로는 "대칭이 맞다"까지만 알 수 있고,
실제로 `featured_request_id`와 need_* 7필드가 어떻게 되는지는 실행해야 안다.

- `createCustomerFromRequest` / `createCustomerFromConsultation` / `linkRequestToCustomer` /
  `linkConsultationToCustomer` × (요청 0건 / 요청 있음) 조합
- ⚠️ **트랜잭션 롤백으로** 한다(공유 master — 실고객·실알림 금지). 알림 테이블을 건드리면
  `withNotifyGuard` 또는 `guardedDb`(`AGENTS.md` 운영 알림 트리거 항목).
- ⚠️ 픽스처 접두사는 `src/test-utils/fixture-codes.ts` registry에 **먼저 등록**한다.

## 하지 않는 것

- **적대 검증은 심각도 상/중에만** 붙인다(하는 기록만 — 배치 15 관례).
- **변이 주입(mutation)은 하지 않는다.** 경량 기본형은 읽기 + 실측이다. 변이를 넣으려면
  worktree 격리 + 5단계 자가검증(전 GREEN 확인 → 주입 → 재실행 → 원복 → `git status` clean)이
  선행이고, 그건 풀 감사 절차다.
- 누적 건수로 범위를 넓히지 않는다. 위 A1·A2 + 실측 렌즈로 끝낸다.

## 판정 기록 (2026-07-25 실시 · 유슨생 세션)

| 심각도 | 건수 | 비고 |
|---|---|---|
| 상 | 0 | |
| 중 | 2 | M1·M2 — 둘 다 적대 검증 CONFIRMED |
| 하 | 5 | L1~L5 (기록만, 배치 15 관례) |
| 행위 변경 | 0 | 체크 자체는 읽기+롤백 실측만. 수정 시 L1만 행위 변경(아래) |

### 중 (적대 검증 통과)

- **M1 — link 2경로 customer_profile 재임베딩 누락**(`#357`·`#358` 후속 누락). `linkRequestToCustomer`·
  `linkConsultationToCustomer`가 `featureFirstRequestOf`로 **need_* 7필드를 덮게 됐는데**(07-25), 라우트는
  여전히 `schedulePromotionEmbeds({appUserId})`만 불러 customer_profile 청크가 스테일로 남는다.
  7필드 전부가 청크 구성 필드임은 `customers.ts`의 feature 라우트 주석("파생 7필드 전부가
  CUSTOMER_PROFILE_EMBED_KEYS 구성 필드다")이 스스로 증언한다. `promotion-embeds.ts`의 "link는
  app_user_id·phone만 바꾼다" 전제가 07-25에 깨졌고 **`promotion-embeds.test.ts`가 그 구 전제를 잠그고
  있다**(수정 시 테스트도 함께). 0709 감사의 "상담 승격 라우트 quote_request 훅 누락"과 같은 부류.
  영향: link된 고객의 니즈가 업무 AI 코퍼스에서 구값 — 다음 프로필 PATCH나 수동 백필 전까지 지속.
  수정 = link 라우트 2곳에 `customerId` 전달 + 주석·테스트 갱신(hash skip이 요청 0건 no-op을 흡수하므로
  무조건 전달해도 무해).
- **M2 — 실채번 견적 잔재가 그물 밖**. `routes/quote-requests.test.ts` promotedQuoteIds 케이스가
  **임의의 실고객**(정렬 없는 `limit(1)`)에 실채번(QT-YYMM) 견적 2건을 **실 INSERT**(finally 삭제).
  실행이 끊기면 `check-test-residue`의 두 그물(①QT 접두사 정규식 ②픽스처 고객 소속) 모두 비껴가는
  유령 "작성중" 견적이 실고객 견적함에 남는다 — 0710 `CU-EMBRT` 유령과 같은 부류인데 이번엔 그물이
  못 본다. 수정 = 픽스처 고객(등록 접두사)을 만들어 거기에 견적을 달기(고객 앵커로 포착).

### 하 (기록만)

- **L1** — `/ai-settings` 라우트 게이트 부재: admin 전용 메뉴 구역("차선생 앱 설정") 항목 중 유일하게
  라우트 게이트가 없다(insights·knowledge-base·org-members·partners·handoff-operation은 `isAdmin`).
  정적 목업(훅 0·저장 없음)이라 실해 0. 게이트 추가는 행위 변경(비admin URL 직접 진입 차단) —
  **유슨생 그 자리 승인(2026-07-25)으로 이행**(등재 불요 규칙).
- **L2** — `createCustomerFromRequest` 신규 분기가 `featureFirstRequestOf` 대신 인라인 재구현
  (`firstRequestIdOf ?? requestId` — 폴백은 도달 불가). 기능 동등하나 "모든 경로가 이 함수를 부를 것"
  주석과 어긋나, 파생 로직이 함수에만 추가되면 이 경로가 빠질 씨앗.
- **L3** — `routes/quote-requests.test.ts` 161·210행: 정렬 없는 `limit(1)`로 집은 임의 요청의 유저가
  **요청 ≥2건**이라 가정. 단일 요청 유저가 heap 첫 행이 되는 순간 false red.
- **L4** — 같은 파일 315행("레거시 요청은 need_timing을 건드리지 않는다"): 임의 유저의 **최초 요청이
  레거시(timing 없음)**라 가정. V2 요청만 가진 신규 유저가 늘수록 시한폭탄.
- **L5** — `vehicles.test.ts`·`catalog-counts.test.ts`가 라이브 master catalog **정확 건수를 하드코딩**
  (브랜드 33·모델 265·트림 1669·무옵션 57·관계 6236). MC 마스터에서 트림 하나만 추가돼도 결정적으로
  빨개진다 — 오늘 사고와 같은 "데이터 변화로 깨지는" 부류인데 이쪽은 확률이 아니라 확정.

### 개선 기회 (결함 아님)

- `test:server` 78파일 중 **~37파일이 DB 미참조**. 특히 `profiles-write-guard`(read 전용 계약 tripwire)·
  `roles-parity`(Edge 복제 파리티)·`updated-at-clock-guard`(DB 시계 tripwire) 같은 **계약 가드가 전부
  CI 밖** — 로컬에서 안 돌리면 영구 침묵. 순수 부분집합만 CI에 넣는 검토 가치 있음(시크릿·DB 불요).

### 실측 렌즈 결과

4경로 × (요청 0건/있음) 6시나리오 전 롤백 재현 → **전부 설계 일치**: 요청 있음 4경로 모두
대표=최초 요청(D1)·need_* 파생(D5, 수기 잔값을 덮고 빈 필드는 null로), 요청 0건은 대표 null 유지 +
수기값 보존(D2, link)·상담 차종 시드(create). 잔재 0건 실측(픽스처 코드·이름·상담 모두).

- 착수일: 2026-07-25
- 소요: 약 1시간 (단일 세션, 에이전트 0)
- 결론: **경량 기본형이 값어치를 증명** — 풀 감사 없이 중 2(둘 다 07-25 당일 변경의 후속 누락 + 그물
  설계 구멍)·하 5를 잡았다. **수정 이행(같은 세션·유슨생 승인)**: M1(link 2경로 customerId 동봉 +
  회귀 그물 1케이스)·M2(픽스처 고객 앵커)·L1(게이트)·L3·L4(결정적 픽스처)·L5(성질 검증 전환) —
  L2만 다음 그 파일을 만질 때 함께(리팩토링성·기능 동등). M1 소급 보정 = 백필 1회(hash 기반이라
  link된 고객만 재임베딩).
