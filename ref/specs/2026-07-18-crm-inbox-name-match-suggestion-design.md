# 인박스 이름 매칭 제안 — 중복 고객 예방 설계 (2026-07-18)

## 1. 문제

인박스("상담 신청 DB" `ConsultationRequestsPage` · "앱 견적요청" `AppRequestsPage`)의 기존 고객 매칭은 `app_user_id` → `phone`(앱 미연결 고객) 2단계만 본다. **이름은 매칭에 쓰지 않는다.**

그래서 수기 고객 "김지운"(번호 Y)이 이미 있는데 앱 유저 "김지운"(번호 X)이 상담/견적요청을 넣으면, 번호가 달라 phone 매칭이 실패 → `none`("신규(미연결)")으로 표시 → 상담사가 `[고객 생성]`을 누르면 **두 번째 김지운**이 생긴다(앱 연결·번호 X 합성). 경고도 병합도 없다. spec `2026-07-17-crm-customer-phone-ownership-design.md` §6에 후속으로 박제된 항목.

## 2. 결정(유슨생, 2026-07-18)

1. **방향 = 예방(병합 아님)**: 이미 생긴 중복을 합치는 병합 엔진이 아니라, **중복이 생기기 전에** 같은 이름의 미연결 고객을 제안한다. 상담사가 `[고객 생성]` 대신 기존 고객에 `[연결]`하면 앱 계정이 그 수기 고객에 붙어 메모·할일·견적이 보존된다(기존 `link` 라우트 재사용 — 병합 엔진 불필요).
2. **범위 = 두 인박스 모두(미러 계약)**: 상담 인박스(클라 파생)와 견적요청 인박스(서버 파생) 양쪽. 한쪽만 고치면 다른 쪽에선 여전히 중복이 생긴다.
3. **동명이인 안전 = 자동 연결 금지**: 이름은 약한 신호(동명이인 존재)라 자동 연결하지 않는다. 후보를 노출하고 상담사가 `[연결]`로 확정한다. 동명 후보가 여럿이면 전부 나열한다.

## 3. 매칭 계층

현재: `app_user > phone > none`. **matchType은 바꾸지 않는다**("연결" 버튼 의미론·기존 테스트 불변). `none`일 때만 별도 필드 `nameMatches`에 같은 이름의 미연결 고객을 담는다.

- **후보 = 앱 미연결 고객 중 이름 일치**(정규화 후). 연결 고객(`app_user_id` 보유)은 제외 — 이미 다른 사람에 확정 매칭됐거나(가족 공유) 자기 자신이라 후보일 이유가 없다. phone 매칭 후보 제외 규칙(spec §3-6)과 동일 사유.
- **`none`에서만 채운다**: matchType이 `app_user`/`phone`이면 `nameMatches = []`(phone이 이미 잡은 고객을 이름으로 중복 제안하지 않는다).
- **이름 정규화**: `name.trim().replace(/\s+/g, " ").toLowerCase()`. 한글 이름은 보통 공백이 없어 trim이 주효과, 영문("Daniel Kang")은 내부 공백 1칸 정규화. digits 매칭(phone)과 별개 함수.
  - **각주(서버 fetch 한계)**: 견적요청(서버 파생)은 고객을 효율상 조건부로 로드(현 `phone IN OR appUserId IN`)하므로 이름 매칭을 위해 쿼리에 `OR name IN (요청자 이름)`을 추가한다. fetch는 **exact `customers.name`**이라, 요청자 이름과 고객 이름이 공백/대소문자만 다른 변형은 fetch 단계에서 놓친다(정규화는 JS 그룹핑에만 적용). 한글 이름은 사실상 무관. 상담(클라 파생)은 App이 전체 고객 목록을 메모리에 들고 있어 완전 정규화된다 — 의도적 비대칭.
- **동명 다수**: 같은 정규화 이름의 미연결 고객이 여럿이면 전부 후보로(자연히 소수 — 미연결 동명 고객은 드물다). 상한은 두지 않되, 표시 안정성을 위해 고객번호 오름차순 정렬.

## 4. 데이터 모델

- 상담(클라): `ConsultationInboxGroup.nameMatches: { id, name, code }[]`(`MatchedCustomer` 재사용).
- 견적요청(서버→클라): `AppQuoteRequestRow.nameMatches` + 클라 `AppQuoteRequest.nameMatches` 동형 배선.
- 매칭 대상 이름: 상담 = 최신 폼 `customer_name`(그룹 `name`), 견적요청 = 요청자 이름(기존 매칭 소스와 동일 필드).

## 5. 화면 (두 인박스 공통 패턴)

`none` 매칭 셀에서 `nameMatches.length > 0`이면 `[고객 생성]` 위에 인라인 제안:

```
이름이 같은 미연결 고객이 있습니다:
  김지운   CU-2605-0018   [연결]
  김지운   CU-2605-0031   [연결]      ← 동명이인이면 여러 명
[+ 새 고객으로 생성]                    ← 기존 버튼 유지
```

- `[연결]` = 기존 link 라우트(`linkConsultationToCustomer` / `linkRequestToCustomer`)에 **선택한 후보 id**를 넘긴다. `handleLink`를 `(item, customerId?)` 시그니처로 확장(기본값 = 기존 단일 `matchedCustomerId` — 기존 phone/app_user 매칭 경로 불변).
- link 성공·충돌 처리(droppedPhone 토스트·정방향 충돌 인라인 안내 #225)는 기존 handleLink 경로 그대로 재사용.
- 게이팅: 제안 `[연결]`도 기존 `canPromote`(userId 필수) 게이트 적용 — link 라우트가 userId를 요구.
- 어휘/톤: 매칭 칩 계열 CSS(quote-inbox.css) 재사용, 신규 클래스 최소. 두 페이지 동형 마크업(미러).

## 6. 서버 (견적요청만)

`src/db/queries/quote-requests.ts` `buildAppQuoteRequestRows`: 기존 고객 로드 루프(현 `custByPhone` 구축)에서 `custByNameUnlinked: Map<normName, {id,name,code}[]>`를 함께 만들고, `matchType === "none"`일 때 `nameMatches = custByNameUnlinked.get(normName(requesterName)) ?? []`. 서버 변경은 이 파생 + 반환 필드뿐(라우트·스키마 불변). 상담은 서버 무변경(클라 파생).

## 7. 범위 밖(불변)

- 이미 생긴 중복의 사후 병합(레코드 결합) — 여전히 후속.
- droppedPhone 선택 UI — 현행 토스트 유지(유슨생 2026-07-18 결정 — 발생 조건 희박·무음 아님).
- 이름 유사도(오타·초성) 매칭 — 정확 일치(정규화)만. 퍼지 매칭은 오탐 위험이라 도입 안 함.

## 8. 검증

- 순수 계층 유닛(consultation-inbox.ts): 같은 이름 미연결 후보 노출 · 연결 고객 제외 · phone 매칭 시 nameMatches 빈 배열(none 아님) · 동명 2명 전부 나열 · 이름 정규화(공백/대소문자).
- 서버 유닛(quote-requests buildAppQuoteRequestRows): 실 DB 픽스처로 이름 매칭 파생 왕복(none + 동명 미연결 고객 → nameMatches 반환).
- typecheck 0 · lint 0 · test:unit · test:server · build · knip delta.
- 브라우저 스모크(선택): 인박스 none 행에 이름 후보 노출 → [연결] → "연결됨" 전환. (거대 페이지라 수동 검증 관례 적용 가능.)
