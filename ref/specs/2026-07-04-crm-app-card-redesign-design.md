# 앱카드 4섹션 리디자인 설계 (2026-07-04)

상태: 디자인 확정(이사님 스크린샷 4장 + 갭 결정 4건, 유슨생 전달) · 구현 전
선후관계: **이 슬라이스가 견적 앱 발송 파이프라인보다 선행** — 발송 payload가 이 카드 데이터를 기반으로 하기 때문(brief 참조).

## 배경

- CRM 견적 워크벤치의 "앱카드보기"(AppCardPreview)를 이사님 확정 디자인(4섹션 상세 카드)으로 전면 확장한다. 이 카드가 곧 고객 앱 견적함에 노출될 실물이며, CRM 프리뷰는 그 미러다.
- 데이터 검증 완료(2026-07-04): 카드의 필드는 `crm.quotes`(+`guidance` jsonb) + `crm.quote_scenarios`(대표=`primary_scenario_id`)에 **거의 전부 기존재**. 금리·반납/인수 총비용은 데이터가 있는데 현 `buildAppCardModel`이 NO_SOURCE("—")로 미배선 — 이번에 연결.

## 카드 4섹션 필드 명세 (디자인 스크린샷 기준 — 이미지 원본은 유슨생 보유)

### 섹션 1 — 헤더·핵심 요약 (녹색 헤더 카드)

| 표시 | 예시 | 데이터 소스 |
|---|---|---|
| 상태 헤더 | 🔔 미확인 견적 + ● D-6 | app_status/viewed_at 기반 라벨 + valid_until D-day(갭ⓐ 참조) |
| 브랜드/차명 | BMW / X7 xDrive 40i M Spt 7인승 | brand_name + model_name·trim_name |
| 칩 2개 | 운용리스 · 60개월 | 대표 시나리오 purchase_method·term_months |
| 서브라인 | 2026년식 ㅣ 154,480,000원 ㅣ 추가옵션 없음 | modelYear·base_price·options(없으면 "추가옵션 없음") |
| 월 납입금(대) | 1,473,200원 + 금리 5.32% 칩 | 시나리오 monthly_payment·interest_rate |
| 잔존/총비용 행 | 잔존가치 71,853,240원 (58%) ㅣ 총 비용 167,652,170원 | residual_mode/value(% 병기 계산) · total_return_cost 또는 total_takeover_cost(표시 규칙: 구현 시 확정 — 디자인 원안은 단일 "총 비용") |
| 할인 행(녹색) | 최대 할인 적용 (타사할인) -11,000,000원 | discount_lines(라벨) + final_discount |
| 2칸 그리드 | 보증금 0원 (무보증) / 주행거리 연 20,000km | deposit_mode/value · mileage_mode/value |
| 📊 견적 핵심 포인트 | bullet 목록(3개 예시) | guidance.keyPoints[] (갭ⓑ — 복수화) |
| 하단 버튼 | "이 견적으로 상담 시작하기" + "● 상세 견적" | 앱 기능(채팅 연결) — CRM 프리뷰에선 장식(비활성) |

### 섹션 2 — 출고 정보 + 취득원가 구성 (파란 헤더 2블록)

**블록 A: 🚗 "{출고시기 코멘트}"** (헤더 텍스트 자체가 guidance.deliveryComment)
- 외장 컬러 / 내장 컬러 = exterior/interior_color_name · 추가 옵션 = options
- 재고 여부(재고 있음=녹색) = guidance.stockNotice · 예상 출고 기간 = guidance.expectedDelivery · 고객 지역 = guidance.customerRegion

**블록 B: 📌 "취득원가 구성을 확인하는 것이 중요해요"** (접기 토글 ∧)
- 차량 기본가격=base_price · 추가 옵션가격=option_total · 할인금액=−final_discount · **최종 차량가격①**=final_vehicle_price(녹색)
- 취득세(포함/감면 모드 병기)=acquisition_tax(+acquisition_tax_mode) · 공채(면제)=bond · 탁송료(불포함)=delivery · 부대비용(불포함)=incidental
- **등록비용 합계②**(녹색, 계산) · **취득원가①+②**=acquisition_cost(파랑)

### 섹션 3 — 추천 견적 조건 (파란 헤더, 대표 시나리오 전체)

📄 "가장 추천드리는 견적 조건입니다!" (접기 토글)
- 구매방식·금융사(lender)·리스기간(term_months)·약정주행거리(mileage)·보증금((20%) 28,560,000원 — %+금액 병기)·선수금(동일)·잔존가치(동일)·자동차세(car_tax_included 포함/불포함)·전기차 보조금(subsidy_applicable/amount, 비해당="해당 없음")
- 금리(잔존가치 지불 시)=interest_rate(녹색) · 반납까지 총 비용=total_return_cost · 인수까지 총 비용(인수 시 취득세 별도)=total_takeover_cost
- **최종 월 납입금**=monthly_payment(파랑, 대) · **출고 전 납입금액**=due_at_delivery(파랑, 대)

### 섹션 4 — 추천 이유 + 서비스 + 푸터

**블록 A: 💡 "이 견적을 추천드리는 이유는요"** — ✓ bullet 목록(강조 span 포함 자유 텍스트) = guidance.recommendReason(복수 줄)
**블록 B: 🎁 "서비스가 빠질수가 있나요"**(주황 헤더) — "라벨: 내용" 행 목록(예: 썬팅/블랙박스/하이패스/유리막코팅/생활보호 PPF/출고 기념품) = guidance.services[] (갭ⓒ — 칸 동적 확장)
**푸터**: 발송시각(26/04/16 18:07) + No.(갭ⓓ) = sent_at(발송 전엔 프리뷰 표기) + quote_code

## 갭 결정 (이사님, 2026-07-04)

- **ⓐ D-day**: 워크벤치 입력 없음. **발송 시점 자동** — 앱 발송으로 고객 견적함에 들어가는 순간 `valid_until = sent_at + 7일` 서버 스탬프, 카드 D-day는 그 카운트다운(D-7→만료). 발송 전 프리뷰는 "D-7(발송 시 시작)" 형태 표기(구현 시 확정).
- **ⓑ 핵심 포인트**: **복수 입력** — 워크벤치에서 `+`로 입력칸 추가(guidance.keyPoint 단일 문자열 → keyPoints 배열. 기존 데이터는 read 시 단일→배열 호환 처리).
- **ⓒ 서비스**: **`+`로 칸 확장**(4칸 고정 → 동적 추가. 데이터는 이미 배열이라 스키마 무변경).
- **ⓓ No.**: **기존 견적번호(quote_code) 그대로 노출**(디자인의 "260400153"은 목업 숫자). ※유슨생 "맞아" 답변의 해석 — 구현 전 재확인 1회.

## 구현 범위 (CRM 단독)

1. `client/src/lib/app-card.ts` — `AppCardModel`·`buildAppCardModel` 확장: 4섹션 전체 필드(금리·총비용·취득원가 구성·시나리오 상세·guidance 신필드) 배선. NO_SOURCE 미배선(금리 등) 해소. 순수 함수 — TDD.
2. `client/src/components/AppCardPreview.tsx` — 4섹션 리라이트(접기 토글 2곳, 상담 시작 버튼은 비활성 장식). CSS는 신규 `app-card-*` 클래스(kim-* 신규 생성 금지 — 리네임 완료 상태 유지), 도메인 파일은 styles 분할 규칙 준수.
3. 워크벤치 입력 보강 — 핵심포인트 복수(+)·서비스 칸 동적(+). guidance zod 스키마(keyPoints) 갱신+하위호환.
4. 발송 시 `valid_until = now + 7일` 스탬프(src/db/queries/customer-quotes.ts의 appStatus==="sent" 지점 — 기존 sent_at 스탬프와 동일 위치).
5. '앱카드보기' 모달의 "작성완료 저장 선행" 현 동작 유지.

## 범위 밖

- 견적 앱 발송 파이프라인(public 수신 테이블·앱 표시) — 다음 슬라이스(payload=이 카드 데이터).
- "이 견적으로 상담 시작하기" 실동작(앱 채팅 연결) — 앱 슬라이스.
- 견적 계산엔진(월납입금 자동 산출) — 별도 보류(수치는 여전히 워크벤치 수기 입력).

## 검증

- buildAppCardModel 유닛(TDD — 필드 매핑·모드 병기 포맷·D-day·호환 처리) + 기존 4종+build.
- 브라우저 스크린샷을 디자인 4장과 대조(유슨생 이미지 재첨부) — 시각 스펙 준수 확인.
