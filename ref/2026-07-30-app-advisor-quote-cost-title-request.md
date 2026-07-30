# 앱 팀 요청 — 상담사 견적 카드 취득원가 행 제목에 포함/불포함 병기 (2026-07-30)

## 요약

CRM 워크벤치의 취득원가 설정(공채/탁송료/부대비용 **포함·불포함** 토글)이 실동작화되어
(CRM PR #401), 그 상태가 `advisor_quotes.payload`에 **신규 필드 3개**로 실리기 시작했습니다.
카드의 취득원가 구성 행 제목에 이 어휘를 조합해 주세요 — **취득세 (일반)과 완전 동형 패턴**입니다.

## payload 계약 (CRM이 이미 발송 중)

| 필드 | 타입 | 값 |
|---|---|---|
| `bondIncludedLabel` | string | `"포함"` 또는 `"불포함·고객 부담"` |
| `deliveryFeeIncludedLabel` | string | 상동 |
| `incidentalIncludedLabel` | string | 상동 |

- 어휘는 CRM이 완성해 보냅니다(`costIncludedLabelOf`, app-card-labels SSOT) — 앱은 그대로 조합만.
- **'원' 부착 대상 아님**(acquisitionTaxModeLabel과 동일). 금액 필드(`bondLabel` 등)는 기존 그대로
  맨숫자 유지 — 값 쪽은 아무것도 안 바뀝니다.

## 렌더 변경 (advisor_quote_card.dart, 한 줄씩 3곳)

```dart
// 현행 (advisor_quote_card.dart:465-467)
_row('공채', '${_p.bondLabel}원'),
_row('탁송료', '${_p.deliveryFeeLabel}원'),
_row('부대비용', '${_p.incidentalLabel}원'),

// 요청
_row(_p.bondIncludedLabel == null ? '공채' : '공채 (${_p.bondIncludedLabel})', '${_p.bondLabel}원'),
_row(_p.deliveryFeeIncludedLabel == null ? '탁송료' : '탁송료 (${_p.deliveryFeeIncludedLabel})', '${_p.deliveryFeeLabel}원'),
_row(_p.incidentalIncludedLabel == null ? '부대비용' : '부대비용 (${_p.incidentalIncludedLabel})', '${_p.incidentalLabel}원'),
```

- **null 폴백 필수**: 이 필드가 없는 **과거 발송 카드**는 제목을 구형("공채") 그대로 둡니다.
  백필 없음 — kind-first 전환(2026-07-11) 때와 같은 영구 커버 방식입니다.
- freezed 모델(`advisor_quote.dart`)에 nullable string 3필드 추가가 전부입니다.

## 표시 예 (CRM 미리보기와 동일해야 함)

```
취득세 (일반)              4,441,810원
공채 (포함)                  100,000원
탁송료 (불포함·고객 부담)     200,000원
부대비용 (포함)              100,000원
```

## 맥락 / 왜

- 포함 = 취득원가 합산(리스 원금에 편입), 불포함 = 출고 시 고객 직접 부담 — 고객이 카드에서
  "탁송료는 별도구나"를 읽을 수 있어야 합니다(이사님 라인 유슨생 결정 2026-07-30).
- `등록비용 합계 ②`·`총 취득원가 ③`는 CRM이 포함분만 합산해 이미 정합 — 앱 계산 없음(기존 그대로).
- 계약표 갱신: `ref/2026-07-05-app-advisor-quotes-handoff.md` 2절에 같은 내용 반영 완료.

미반영 기간에도 깨지는 것은 없습니다(신규 필드는 무시되고 제목만 구형). 반영되면 CRM 미리보기와
카드가 다시 픽셀 동형이 됩니다.
