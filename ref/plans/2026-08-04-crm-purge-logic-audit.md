# 업무 AI 파기 로직 감사 — 계획·판정 SSOT (2026-08-04)

> **새 세션은 이 파일 하나로 시작할 수 있다.** `AGENTS.md` → `ref/active-session-brief.md` →
> 이 파일 순으로 읽으면 충분하고, 필요할 때만 아래 참조 문서를 편다.

## 왜 감사하나 — 트리거 2개 해당

`AGENTS.md` "리팩토링 배치 감사 — 트리거 기반·경량" 규칙의 ⓐ·ⓑ에 걸린다.

- **ⓐ 실 데이터를 변형하는 변경**: 되돌릴 수 없는 삭제 로직 3종 + 마이그레이션 0051 +
  `customer_deletions` 익명화 backfill 실행(1행, 이미 적용됨).
- **ⓑ 외부 계약**: 앱 팀 회신 §7("30일 rolling" · "탈퇴·파기 시 관련 turn 삭제")의 이행물.
  보존 30일은 **개인정보 처리방침에 실리는 숫자**다.

순서상으로도 여기가 맞다 — **출시 전 일괄 정리(244행 실 파기)를 실행하기 전**에 로직을 본다.
잘못 지우면 복구 경로가 없다(백업을 남기지 않는 것이 파기의 정의라 설계에서 뺐다).

## 범위 — PR `#440`(main `7d20f7f`) 전부

```
bun run --silent -- git show --stat 7d20f7f   # 18 files, 2872+/63-
```

핵심 경로만 추리면:

| 경로 | 무엇 | 위험 |
|---|---|---|
| `db/queries/assistant-messages.ts` | `purgeAssistantMessagesOlderThan` / `ForCustomer` / `All` | **전역 삭제 3종** |
| `db/queries/customer-delete.ts` | `purgeCustomerCore`에 대화 파기 추가 | 🟡 하드 삭제(#212)까지 확장 |
| `db/queries/account-deletion.ts` | B 스크럽 경로에 같은 파기 | 보존 고객 대상 |
| `cron/assistant-retention-cron.ts` + `worker.ts` | 일일 크론(10:00 KST)·`waitUntil` 분리 | 자동 실행 |
| `routes/assistant.ts` · `db/queries/assistant-tools.ts` · `lib/assistant-tools.ts` | provenance 수집(도구 9종·RAG·스트림) | 수집 실패 = 조용한 추적 불가 |
| `scripts/purge-assistant-messages.ts` | 전량 파기(미실행) | `--yes` 오타 실행 |
| `drizzle/0051_*.sql` + `db/schema.ts` | `turn_id`·`subject_customer_ids`+GIN | 적용 완료 |

## 앵글 2 + 실측 렌즈 1 (경량형 — `AGENTS.md` ②)

**A1 정합성 — 파기 범위가 과잉인가 과소인가.**
과소(지워야 할 게 남는다): provenance가 안 붙는 경로가 있나(도구 9종 중 누락·`current_user`
빈 배열이 맞나·스트림 중단·`updateAssistantMessage` 경로에서 배열이 날아가나). 과잉(남겨야 할
게 지워진다): `arrayOverlaps`가 **타 고객·타 직원** 대화를 걷어가나, 🟡 하드 삭제 확장이 의도
범위를 넘나. 크론이 경계에서 하루치를 더/덜 지우나(`make_interval` + DB 시계).

**A2 회귀 그물 — 테스트가 그 결함을 실제로 잡는가**(변이 주입).
`#440`에 붙은 6건(경계·계약값·RAG·도구·스트림·통합)에 변이를 넣어 red가 뜨는지 확인한다.
이미 확인된 것: 통합(파기 호출 제거 → red) · 계약값. **미확인**: 경계(31/29일) · provenance 3종.

**L1 실측 렌즈 — 실 DB 롤백 안에서 파기 시뮬레이션.**
실제 244행 분포로 `purgeAssistantMessagesOlderThan(30)`과 `ForCustomer(임의 고객)`를 돌려
**무엇이 지워지는지 눈으로 본다**. ⚠️ 반드시 `db.transaction` + 마지막에 `throw ROLLBACK`.

## ⚠️ 실행 주의 (감사 자체가 사고를 낸 전력이 있다)

- **파기 쿼리는 staff 필터가 없는 전역 삭제**다. 롤백 밖에서 부르면 **공유 master의 실제 직원
  대화가 사라진다**. 테스트/실측 모두 트랜잭션 안에서만.
- 끝나면 **`crm.assistant_messages` 244행 유지**를 실측 확인한다(감사 전 기준선).
- 알림 트리거 4테이블(`consultations`·`advisor_quotes`·`chat_messages`·`chat_sessions`)은
  이 범위에 없다 — 건드리지 않으면 실알림 위험 0.
- 에이전트를 여럿 쓸 거면 **worktree 격리**(배치 14에서 메인 워킹트리 오염 5건).
- `bun run purge:assistant`는 **`--yes` 없이도 조회는 한다** — 감사 중 규모 확인에 써도 안전하다.

## 기준선 (2026-08-04 실측 — 감사 시작 시 재실측할 것)

- CI 8단계 green · unit **1350** · pure **281**
- `crm.assistant_messages` **244행**(직원 4명 · 2026-07-02~07-28) · `turn_id` 보유 **0**
  (도입 전 과거 행 = 추적 불가. **새 대화부터** 채워진다 — 감사 중 실기로 한 건 만들어 확인 가능)
- `crm.customer_deletions` 1행(익명화 완료 — name·app_user_id NULL)
- 30일 초과분 **104행**(크론 첫 실행 대상)

## 참조

- 계약 원문 = `ref/2026-08-01-app-account-deletion-crm-reply.md` §7
- 규약 박제 = `AGENTS.md` "업무 AI 대화 보존 계약"
- PR 본문 = `#440`(설계 의도·한계·🟡 행위 변경)

## 판정 (2026-08-04 · 유슨생 세션 · 경량형 2앵글+렌즈 1 완료)

**상 0 · 중 1 · 하 3 · 행위 변경 0.** 파기 로직 자체의 결함은 **0건**이다 — 지워야 할 것이
남거나 남겨야 할 것이 지워지는 경로를 찾지 못했다. **출시 전 일괄 정리 실행을 막을 이유는 없다.**
발견 1건은 전부 "그물이 그 결함을 잡느냐"(A2) 축이다.

### 🟠 M1 (중) — 경계 테스트가 **"하루 늦게 지우는" 변이를 못 잡는다**

`purgeAssistantMessagesOlderThan`의 경계를 쿼리 안에서 하루 미는 변이가 **전 그물을 통과한다.**
변이 4종을 넣어 실측한 통과/실패 지도:

| 변이 | 실효 보존 기한 | 결과 |
|---|---|---|
| `days - 1` | 29일 | 🔴 red |
| (원본) | 30일 | 🟢 green |
| **`days + 1`** | **31일** | **🟢 green — 놓친다** |
| `days + 2` | 32일 | 🔴 red |

원인은 픽스처가 **31일 전/29일 전**이라 통과 범위가 `(29일, 31일]`로 벌어져 있다는 것이다.
31일 전 행은 임계값이 31일이어도 앱 시계 스큐(앱이 DB보다 뒤처짐)로 아슬아슬하게 파기 쪽에
걸린다 — 그래서 **덜 지우는 방향(계약 위반 방향)만 새는 비대칭**이 된다.

**적대 검증(중이라 규칙대로 부착)**: "그런 변이가 현실적인가"를 실제 리팩토링 형태로 재현했다 —
`make_interval(days => $1)` → **`interval '1 month'`** 치환(흔한 단순화). 결과: **typecheck ·
lint · 경계 테스트(8 pass) · 계약값 tripwire가 전부 통과**하는데 실 파기량은 **104행 → 102행**으로
바뀐다. `ASSISTANT_RETENTION_DAYS` tripwire는 **상수만** 잠그므로 쿼리 안의 경계 이동에 무력이고,
`days` 파라미터가 미사용이 되어도 eslint가 잡지 않는다(첫 인자·after-used).

**실피해**: 사용자 가시 증상 0. 어긋나는 것은 **처리방침에 실리는 숫자와 실제 동작**이고,
그 어긋남은 증상이 없어 아무도 모른다(이 로직의 존재 이유가 정확히 그 지점이다).

**✅ 수정 완료(같은 PR·테스트만 — 프로덕션 코드 무수정)**: 경계 픽스처를 **30일 ±1시간**으로
좁혔다(`RETENTION_BOUNDARY_HOURS ± 1`). 임계값이 정확히 30일일 때만 통과하고, ±1시간은 앱↔DB
시계 스큐(실측 초 단위)보다 3자리수 큰 마진이라 플레이크 위험이 없다. **재검증**: 수정본 green
(8 pass) · `days + 1` **red** · `interval '1 month'` **red** — 감사가 뚫었던 변이 2종을 모두 잡는다.

### 🔵 하 3건 (기록만 — 규칙상 적대 검증 미부착)

- **L1 (A1 과소) — 도구·RAG가 0건이면 provenance가 비는데 저장물엔 이름이 남는다.**
  `customer_quotes`·`customer_consultations`는 innerJoin이라 0행이면 `customerIds: []`인데,
  `label`의 `이름 제임스`가 `sources`에 저장되고 답변 문장에도 이름이 실린다. **실 데이터에 이미
  존재**(이름 라벨 도구 행 12건 · 그중 0건 조회 2건). 다만 그 이름의 출처는 **질문 텍스트**라
  회신 §7에 명시한 한계(`질문 텍스트에만 이름이 나온 턴은 못 잡는다`)와 같은 축이고,
  30일 rolling이 상한으로 막는다. **설계 변경 불요** — 계약 문구가 이미 이 케이스를 덮는다.
- **L2 (A1 과잉) — 리포트형 도구는 조회된 고객 전원을 subject에 싣는다.**
  고객 1명이 탈퇴하면 수십 명을 다룬 리포트 대화가 통째로 사라진다. 안전 방향이고 의도적이다
  (PR 본문 명시). `capReportLines` 상한 30 vs **실 고객 24명**이라 "잘린 행도 포함" 조항은
  현재 발동조차 하지 않는다(실영향 0).
- **L3 (절차) — 🟡 하드 삭제 확장이 `ref/director-pending-confirmations.md`에 미등재.**
  규칙상 "이사님 확정 설계를 뒤집는 건만 등재"라 필수는 아니나, 하드 삭제(`#212`)는 이사님이
  결정한 admin 전용 기능이고 그 파기 범위가 넓어졌다. 같은 파일 **항목 28**에 이미 "업무 AI 기록에
  번호가 남는 것" 질의가 **열린 채**라, 회신 시 이 건을 함께 꺼내면 한 번에 정리된다.

### A1·L1 — 확인했고 문제없던 것

- 파기 3종 · 호출 **5경로**(스태프 삭제 `#212` · PURGE · B 스크럽 · 보존 수렴 · 정산 분리) 전수 확인
- `arrayOverlaps`는 NULL·빈 배열을 걷지 않는다 — 실 DB에 provenance 3행(관련 2 + 무관 1)을 심어
  **관련 2행만 파기·무관 행 생존** 실측(uuid[] 캐스팅·GIN 실동작 확인)
- 크론: DB 시계(`now()`)·`waitUntil` 분리·트리거 1개(`0 1 * * *`)·`HYPERDRIVE` 바인딩 존재·
  catch가 던지지 않음(멱등 재시도) — 정합
- `updateAssistantMessage`(스트림 마감)는 `content`/`sources`만 set → provenance 불변
- provenance 그물 4종 **전부 유효**(변이 → red): user 행 subject · 도구 경로가 RAG 대신 도구 대상 ·
  스트리밍 선저장 · `turn_id` 공유

### 실행 기록 (5단계 자가검증 준수)

- 기준선: typecheck·lint 통과 · 대상 4파일 **62 pass / 0 fail**
- 변이 **6회** 주입 → 각 회차 직후 `git checkout --`로 원복 → **워킹트리 clean 유지**(전 회차 확인)
- **L1 실측**: 트랜잭션 롤백 안에서 `purgeAssistantMessagesOlderThan(30)` = **104행**(경계 07-05
  정확 · 직원별 228/12/2/2 → 124/12/2/2) · `ForCustomer(CU-2605-0020)` = 0행(도입 전 과거 행이라
  정상) · 반쪽 남은 턴 0
- **감사 종료 실측**: `crm.assistant_messages` **244행 · 30일 초과 104 · turn_id 0** = 감사 전과 동일.
  실 데이터·알림 트리거 무손상.
