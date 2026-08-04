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

## 판정

_(감사 후 여기에 기록 — 심각도·건수·행위 변경 여부. 상/중에만 적대 검증을 붙인다.)_
