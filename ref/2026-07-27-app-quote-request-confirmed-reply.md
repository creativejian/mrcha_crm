# [앱 팀 → 차선생 CRM] 견적요청 "담당자 확인 완료"(2단계) 실동작화 — 회신

작성 2026-07-27 · 회신 대상: `2026-07-27-app-quote-request-confirmed-request.md`

> **상태: ①② 완료. 컬럼은 이미 원격 DB에 적용돼 있어 CRM은 지금 바로 ③④를 시작하셔도 됩니다.**
> 앱 PR: [dl-auto/mr-cha-app#765](https://github.com/dl-auto/mr-cha-app/pull/765)

## 요청문 검증 — 짚어주신 근거가 전부 정확했습니다

받은 즉시 앱 코드와 대조했고, **틀린 곳이 하나도 없었습니다.** 라인번호까지 맞았습니다.

| 요청문 주장 | 실측 |
|---|---|
| `my_quotes_screen.dart:3089` 판정이 3분기뿐 | ✅ 라인번호까지 일치 |
| 5단계 문구는 이미 완성 | ✅ `quote_request_progress.dart:5-45` enum + 4종 문구 전부 존재 |
| 2·3·4단계 도달 불가 | ✅ 판정 함수가 그 셋을 한 번도 반환하지 않음 |
| `admin_repository.dart:108` open 카운터 | ✅ |
| `quote_provider.dart:197` · `chat_quote_flow.dart:2230` open 고정 | ✅ 둘 다 정확 |
| `send-push`가 subtitle 지원 | ✅ `parse.ts:19`, `index.ts:49` |

`status`에 값을 추가하지 말자는 판단에 동의합니다. 그 3곳이 실제로 깨집니다.

---

## ① 컬럼 추가 — 완료 (원격 적용까지)

```
migration : 20260727141844_add_quote_requests_confirmed_at.sql
적용       : supabase db push 완료 (2026-07-27)
확인       : psql \d public.quote_requests → confirmed_at | timestamptz | nullable
```

요청하신 형태 그대로입니다. 인덱스는 두지 않았고, 기존 행은 전부 NULL입니다.
컬럼 코멘트도 달아뒀습니다 — *"담당자가 요청을 확인한 시각(CRM이 최초 1회만 기록).
NULL = 미확인. 앱 진행단계 2단계 판정에 사용."*

## ② 진행단계 판정 — 완료

제안하신 코드 그대로 반영했습니다.

```dart
return switch (quote.status?.toLowerCase()) {
  QuoteRequestStatus.completed => QuoteRequestProgressStage.delivered,
  _ => quote.confirmedAt != null
      ? QuoteRequestProgressStage.reviewing
      : QuoteRequestProgressStage.received,
};
```

`QuoteRequest` 모델에도 `@JsonKey(name: 'confirmed_at') DateTime? confirmedAt`를 추가했습니다.
조회 쿼리가 `select('*')`라 select 절 수정은 필요 없었습니다.

표시 문구는 말씀대로 기존 것을 그대로 씁니다(`reviewing.title` = "담당자가 요청을 확인했어요").

---

## 확인 부탁하신 3가지에 대한 답

### 1. 컬럼명 `confirmed_at` — 그대로 좋습니다

저희 관례(`viewed_at`, `sent_at`, `phone_verified_at`)와 일치합니다. 바꿀 이유 없습니다.

### 2. CRM이 직접 UPDATE — 네, 하셔도 됩니다

선례가 있을 뿐 아니라, **이 컬럼은 구조적으로 CRM만 쓸 수 있습니다.** 확인해봤습니다:

```
Users can create their own quote requests            INSERT   ← 고객은 INSERT 만
Staff can update quote request status                UPDATE   ← staff/manager/admin
Users and staff can view relevant quote requests      SELECT
Admin can delete quote requests                      DELETE
```

**일반 고객(`customer`)에게는 UPDATE 정책이 아예 없습니다.** 자기 요청이라도 UPDATE가 안 되니
고객이 스스로 2단계로 올리는 위조 경로가 없습니다. `profiles` 때처럼 별도 쓰기 금지 계약이
필요한 상황이 아닙니다 — **전용 Edge Function 경유도 불필요합니다.**

덧붙여 `quote_requests`에는 **사용자 트리거가 0개**라, CRM의 UPDATE가 기존 알림을 재발화시킬
걱정도 없습니다(`skip_notify` 가드 불요).

### 3. 반영 시점 — 이미 끝났습니다, CRM 일정에 맞추세요

말씀하신 "①만 먼저" 형태로 이미 나가 있습니다.

- **DB 컬럼**: 원격 적용 완료 → **CRM은 지금 바로 ③④ 시작 가능**
- **앱 화면**: PR #765 머지 후 배포 시 따라감

컬럼이 NULL인 동안 앱은 지금과 똑같이 `received`(1단계)로 표시하므로, 순서가 어긋나도
고객에게 이상하게 보이는 구간이 없습니다. **CRM이 전이·푸시를 먼저 시작하셔도 무해합니다.**

---

## 저희 쪽 검증

- `flutter test` 1807개 전부 통과
- `deno check ai-analyst` 오류 0
- pre-commit hook 전체 통과(format/analyze/test/deno fmt·lint/DB 함수 계약 검증)
- TDD — 테스트 RED(`Expected: reviewing, Actual: received`) 확인 후 구현

추가한 테스트 2건:
1. `담당자 확인 시각이 찍히면 2단계(담당자 확인 완료)로 올라간다`
2. `견적이 도착하면 담당자 확인 시각이 있어도 견적 도착 단계가 우선한다` ← 우선순위 회귀 가드

## 푸시(④)에 대해 — 그대로 진행하시면 됩니다

`send-push`의 `subtitle` 지원은 확인하신 그대로입니다. 어제(2026-07-26) 견적 도착 푸시 작업에서
`buildFcmMessage`에 subtitle 경로가 들어갔고, **subtitle 없는 기존 호출부는 title/body 계약으로
폴백**되도록 테스트까지 있습니다(`_shared/fcm_test.ts` 2건). CRM `push-notify.ts`에서 필드만
추가하시면 됩니다.

사건 ID `quote_request.confirmed`, 최초 전이에서만 발송, best-effort — 전부 동의합니다.
5단계 `advisor_quote.sent` 푸시와 별개로 유지되는 것도 맞습니다.

## 3·4단계 — 저희도 이번 범위 밖에 동의합니다

`preparing`·`finalReview`는 "어느 시점을 그 단계로 볼지"가 정해져야 의미가 있다는 판단에
동의합니다. 2단계가 실제 고객 화면에서 안착하는 걸 보고 나서 따로 논의하시죠.

문구·enum은 이미 앱에 있으니, 그때는 **CRM 쪽 시점 정의 + 컬럼 하나**만 있으면 됩니다.
