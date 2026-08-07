# [차선생 CRM → 앱 팀] 견적요청 "담당자 확인 완료"(2단계) 실동작화 요청

작성 2026-07-27 · 요청자: 이사님 · CRM 담당: 유슨생

> ⚠️ **SUPERSEDED (2026-08-07)** — 현행 계약은 `ref/2026-08-07-app-quote-request-ready-for-send-reply.md`다.
> 이 문서와 상충하는 두 지점은 그쪽이 이긴다:
> ① 아래 "3단계(견적 작성 중)·4단계(발송 준비 중)는 푸시하지 않습니다"는 폐기 — 새 체계의
>   3단계(발송 준비 중)는 실제 `작성완료` 사건에서
>   `tag: quote-request-ready-for-send` 푸시가 나간다(CRM `#463`·앱 `#839`).
> ② 단계 번호 체계가 5단계(reviewing/preparing/finalReview 분리)에서 **4단계**로 바뀌었다 —
>   이 문서의 "2단계"는 유지되나 3~5단계 서술은 구 체계다.
> 2단계 자체(`confirmed_at` 최초 전이 + 푸시)는 현행과 일치하며, 2026-08-07 이후 푸시 payload에
> `tag: quote-request-confirmed`가 추가됐다(표시 문구 불변 — 앱 consumer가 subtitle 문자열 일치와
> OR로 같은 분기 처리, `_shared/fcm.ts` privacySafeNotification 실측).

> **요청 요약**: `public.quote_requests`에 **`confirmed_at timestamptz NULL` 컬럼 1개 추가**(①) +
> 앱 진행단계 판정이 그 값을 읽어 **`reviewing`(2단계)을 반환**(②).
> 전이·푸시 발송은 **CRM이 합니다**(③④) — 앱 팀 작업은 ①②뿐입니다.

## 왜 — 앱에 이미 있는 2단계가 도달 불가 상태입니다

앱 `lib/presentation/widgets/quote/quote_request_progress.dart`에 진행 5단계가 **문구까지 완성**돼 있습니다:

| 단계 | shortLabel | 도달 가능? |
|---|---|---|
| 1 `received` | 견적 요청 완료 | ✅ |
| **2 `reviewing`** | **담당자 확인 완료** | ❌ |
| 3 `preparing` | 견적 작성 중 | ❌ |
| 4 `finalReview` | 발송 준비 중 | ❌ |
| 5 `delivered` | 견적 도착 | ✅ |

그런데 판정 함수(`my_quotes_screen.dart:3089` `quoteRequestProgressStage`)는 3분기뿐입니다:

```dart
if (advisorQuotes.isNotEmpty) return QuoteRequestProgressStage.delivered;
return switch (quote.status?.toLowerCase()) {
  QuoteRequestStatus.completed => QuoteRequestProgressStage.delivered,
  _ => QuoteRequestProgressStage.received,
};
```

**2·3·4단계는 정의만 있고 아무도 도달하지 못합니다.** 고객 화면에서는 견적 요청 직후부터 견적이
도착할 때까지 계속 "견적 요청 완료"로 멈춰 있습니다. 그 사이 담당자가 요청을 확인하고 조건을
검토해도 고객은 알 방법이 없습니다.

이사님 요청은 **그중 2단계를 실동작시키는 것**입니다. 3·4단계는 이번 범위가 아닙니다(아래 §범위 밖).

---

## ① `public.quote_requests`에 컬럼 1개 추가

```sql
ALTER TABLE public.quote_requests
  ADD COLUMN confirmed_at timestamptz NULL;
```

- **NULL = 미확인**, 값 있음 = 담당자가 그 요청을 열어 확인함. 되돌리지 않습니다(단조 전이).
- 기존 행은 전부 NULL로 시작합니다 — 과거 요청을 소급해 2단계로 올리지 않습니다.
- **인덱스 불필요**(단건 조회·단건 UPDATE만).

### ⚠️ `status`에 값을 추가하는 방식은 피해 주시길 부탁드립니다

`status`에 `'confirmed'`를 넣는 쪽이 컬럼 추가보다 가벼워 보이지만, **`open`을 기준으로 도는 것들이
조용히 깨집니다.** 저희가 찾은 것만:

- 앱 `lib/data/repositories/admin_repository.dart:108` — `counter(DbTables.quoteRequests, QuoteRequestStatus.open)`
  → 확인된 요청이 관리자 카운터에서 **빠집니다.**
- 앱 `quote_provider.dart:197` · `chat_quote_flow.dart:2230` — 생성 시 `status: open` 고정
- 앱 `core/utils/quote_status.dart` — 라벨/색상 SSOT에 새 값 분기 필요

별도 컬럼이면 위 어느 것도 건드리지 않습니다. 이사님 지시도 "`confirmed_at` 또는 동등한 영속 상태"로
컬럼 쪽을 먼저 제시하셨습니다.

### CRM이 이 컬럼에 UPDATE 해도 될까요?

CRM 서버는 `postgres` 롤이라 기술적으로는 가능하고, **이미 `quote_requests.status`를 `completed`로
전이하고 있습니다**(견적 발송 시 — `src/db/queries/advisor-quotes.ts:60`, 기존 합의된 경로).
같은 선례로 `confirmed_at`도 CRM이 직접 쓰려고 합니다. **다른 방식을 원하시면 말씀해 주세요**
(예: 전용 Edge Function 경유). `public.profiles` 때처럼 쓰기 금지 계약이 필요한 컬럼이라면
그 편이 낫습니다.

## ② 진행단계 판정에 반영

`confirmed_at`이 찍혔고 아직 견적이 안 나갔으면 2단계입니다.

```dart
if (advisorQuotes.isNotEmpty) return QuoteRequestProgressStage.delivered;
return switch (quote.status?.toLowerCase()) {
  QuoteRequestStatus.completed => QuoteRequestProgressStage.delivered,
  _ => quote.confirmedAt != null
      ? QuoteRequestProgressStage.reviewing   // ← 추가
      : QuoteRequestProgressStage.received,
};
```

`QuoteRequest` 모델(`lib/domain/models/quote/quote_request.dart`, freezed)에 필드가 함께 필요합니다 —
기존 필드와 같은 형태면 `@JsonKey(name: 'confirmed_at') DateTime? confirmedAt` 정도가 되겠습니다.

**표시 문구는 이미 있는 것을 그대로 쓰면 됩니다** — `reviewing.title` = "담당자가 요청을 확인했어요" /
`description` = "담당자가 요청하신 차량과 구매 조건을 확인했어요".

---

## ③④ CRM이 하는 일 (참고 — 앱 팀 작업 아님)

**③ 전이**: 고객 상세의 개별 차량 요청 카드에서 **"견적 작성"을 처음 누르는 순간**, 서버에서
`UPDATE ... SET confirmed_at = now() WHERE id = $1 AND confirmed_at IS NULL`로 **한 번만** 전이합니다.

- 단위는 고객이 아니라 **개별 `quote_request`**입니다.
- "견적 작성"과 "추가 작성"이 CRM에서 **같은 핸들러**라, 다시 열거나 추가로 눌러도 위 조건절에서
  걸러져 **중복 전이가 발생하지 않습니다.**

**④ 푸시**: 위 UPDATE가 **실제로 행을 바꿨을 때만**(= 최초 전이) 발송합니다.

| | 값 |
|---|---|
| 사건 ID | `quote_request.confirmed` |
| 수신자 | 해당 `quote_request.user_id` |
| iOS title | 차선생 |
| subtitle | 담당자가 요청하신 견적 조건을 확인했어요 |
| body | `<브랜드> · <모델·트림>` |
| 발송기 | **기존 `send-push`** (신규 함수 없음) |
| 실패 처리 | **best-effort** — 푸시가 실패해도 CRM 견적 작성은 진행됩니다 |

버튼 클릭마다 쏘는 게 아니라 **영속 상태의 최초 전이에서만** 발생시킵니다. 그래야 앱의 2단계 표시와
푸시 중복 방지가 **같은 사실 하나**를 근거로 삼습니다(이사님 지시 사항).

> `send-push`는 이미 `subtitle`을 지원하는 것으로 확인했습니다(`parse.ts:19` `raw.subtitle ?? ""`,
> `index.ts:49`). CRM `push-notify.ts`가 지금 `{user_id, title, body}`만 보내고 있어서 **저희 쪽에서
> 필드를 추가**하면 됩니다. 새 발송기는 필요 없습니다.

### 기존 푸시와의 관계

- **5단계 견적 도착 푸시(`advisor_quote.sent`)는 그대로 유지**됩니다. 이번 건은 그 앞에 하나가
  더 생기는 것이고, 두 알림은 시점도 내용도 다릅니다.
- 3단계(견적 작성 중)·4단계(발송 준비 중)는 **푸시하지 않습니다.**

## 범위 밖 — 3·4단계는 이번에 건드리지 않습니다

`preparing`·`finalReview`도 지금은 도달 불가지만, 이번 요청에서는 **손대지 않습니다.** 그 둘은
"작성 중"·"발송 준비 중"이라는 CRM 내부 작업 상태를 실시간으로 반영해야 해서, 어떤 시점을 그
단계로 볼지부터 정해야 합니다(초안 저장? 시나리오 입력? 발송 직전?). 2단계가 안착한 뒤 따로
논의하는 편이 좋겠습니다.

## 확인 부탁드릴 것

1. **컬럼명 `confirmed_at`으로 괜찮은지** — 다른 관례가 있으면 맞추겠습니다.
2. **CRM이 그 컬럼에 직접 UPDATE 해도 되는지** (위 §CRM이 이 컬럼에 UPDATE 해도 될까요 참조).
3. **①② 반영 시점** — CRM 쪽(③④)은 컬럼이 생겨야 의미가 있어서, 배포 순서를 맞추려 합니다.
   ①만 먼저 나가도 CRM은 전이·푸시를 시작할 수 있습니다(앱 화면만 나중에 따라오는 형태).

급하지 않습니다. 편하신 순서로 알려주시면 CRM 쪽 일정을 맞추겠습니다.
