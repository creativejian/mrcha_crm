# 고객 전화번호 소유권 분리 — 설계 (2026-07-17)

세션 0717-release-brainstorming(유슨생). 배경 논의 = 앱 유저 매칭 감사 중 발견.

## 1. 문제

`crm.customers.phone` 하나에 **두 소유자**가 섞여 있다.

- 수기 고객: 상담사가 입력한 번호(정당한 편집 대상).
- 앱 연결 고객: 승격 시점에 `public.profiles.phone_number`(또는 상담 폼 번호)를 **복사한 스냅샷** — 이후 앱에서 번호가 바뀌어도 CRM은 모른다(변경 훅 없음).

실측(2026-07-17, 앱 연결 2명): 제임스 = CRM `01012345678`(더미) vs 앱 `01054868279` **불일치**, 김지안 = CRM 공란 vs 앱 `01095880812`. **일치 0명.** 승격 경로별로 phone 처리도 3갈래로 다르다(견적요청 create=profile 복사 / 상담 create=폼 우선 / 상담 link=빈 칸 보강 / 견적요청 link=불변).

추가 요구(유슨생): 고객이 "다른 번호로 연락달라"는 실무 케이스가 종종 있어 **두 번째 번호**가 필요하다.

## 2. 전제(앱 팀 확정 사항)

- 앱은 휴대폰 인증을 강제한다(`profiles.phone_number` = 인증된 본인 번호). 빈 값은 과거 테스트 계정뿐.
- 상담 신청은 **로그인 필수**(비로그인 상담 없음 — 유슨생 확인 2026-07-17) + **등록된 번호로만** 신청 가능하게 바뀐다 → 상담 폼 번호 = 앱 번호가 되어 "폼 우선" 규칙은 의미 소멸.
- 과거 상담 폼 번호 실측: 불일치 47건 전부 테스트 노이즈(유재민 계정 44건이 매번 다른 임의 번호). **과거 폼 번호를 백필할 가치 0 — 하면 유령 번호가 화면에 뜬다.**

## 3. 결정(유슨생, 2026-07-17)

| | 소유자 | 저장 | 편집 | 존재 조건 |
|---|---|---|---|---|
| **앱 번호** | 고객(앱) | 저장 안 함 — `profiles.phone_number` **파생(read-through)** | 🔒 불가 | 앱 연결 고객만 |
| **연락처** `phone` | 상담사(CRM) | `crm.customers.phone` | ✎ 가능 | **앱 미연결 고객만** |
| **추가 연락처** `phone_secondary` | 상담사(CRM) | 신설 컬럼 | ✎ 항상 가능 | 누구나 |

1. **불변식**: `app_user_id IS NOT NULL → phone IS NULL`. DB CHECK로 강제. `phone` 컬럼의 의미가 "앱 미연결 고객의 주 번호" 하나로 고정된다(한 컬럼 두 소유자 원천 차단).
2. **주 번호 표시값은 서버가 합성**: `listCustomers`/`getCustomer` 응답의 `phone` = `profiles.phone_number ?? customers.phone`(LEFT JOIN). 클라 목록·검색·상세 표시 코드는 값만 정확해지고 무변경. 앱에서 번호를 바꾸면 다음 조회부터 자동 반영(동기화 코드 0줄, 스테일 원리적 불가 — viewed_at read-through #159 선례).
3. **추가 연락처**: 라벨 없음(번호만 — 맥락은 상담 메모). 연락용 전용, **매칭에 쓰지 않는다**(회사·배우자 번호일 수 있어 동일인 추정 근거가 못 됨 — 오매칭 방지).
4. **연결(link) 시 전이 규칙**: 대상 고객의 기존 `phone`이
   - 앱 번호와 **같으면 버린다**(중복 — 화면 변화 없음. phone 매칭으로 연결하는 흔한 경로가 이 케이스).
   - **다르면 `phone_secondary`로 내린다**(상담사가 확인해 적은 번호를 잃지 않는다).
   - secondary가 이미 차 있고 값이 다르면: 연결은 막지 않고 기존 phone은 버리되 **응답에 `droppedPhone`으로 표면화**(클라 토스트). 선택 UI는 후속(v1은 알림만).
   - 어느 경우든 `phone`은 NULL로(불변식 성립).
5. **승격(create) 경로의 앱 유래 phone 복사 전부 제거**: 견적요청 승격의 `profile?.phoneNumber`, 상담 승격의 폼 우선(`req.phoneNumber || profile`), 상담 link의 빈 칸 보강 — 전부 삭제. 승격·연결은 phone을 쓰지 않는다(표시는 §3-2 합성이 담당).
6. **매칭(동일인 추정)은 주 번호만 + 앱 미연결 고객만**: 앱 연결 고객은 `app_user_id`로 이미 확정 매칭이므로 phone 후보에서 제외. 클라 매칭 인덱스(consultation-inbox)는 합성 phone을 받으므로 **`appUserId` 보유 고객을 byPhone에서 명시 제외**(서버 quote-requests는 불변식상 자동 성립하나 방어 조건 병기). 부수 효과: 김지운·김지안↔김민준 전화 공유 오매칭 후보가 연결 후 자동 소멸.
7. **쓰기 게이트**: `PATCH phone`은 대상 고객에 `app_user_id`가 있으면 **409 거부**("앱 등록 번호는 수정할 수 없습니다"). `phoneSecondary`는 항상 허용. 클라는 편집 popover 진입 자체를 차단(토스트 — 자동 접수 경로 차단과 동일 문법), 서버가 진짜 게이트.
8. **서버 정규화 강제**: PATCH·POST의 `phone`/`phoneSecondary`를 zod transform으로 숫자만 남긴다(빈 결과는 null). 기존 "클라가 숫자만 전송(서버 정규화 없음)" 관례 의존 제거 — 클라·서버 매칭이 원문 비교라 하이픈 유입 시 조용히 깨지던 잠재 드리프트 해소.
9. **목록·검색**: 추가 연락처도 목록에 노출(이사님·유슨생 결정 2026-07-17). 고객 셀 연락처 줄에 병기, 검색 대상(searchable)에도 포함(보이는데 검색 안 되면 고장으로 읽힘).

## 4. 마이그레이션(0034)

- `phone_secondary` text 컬럼 추가.
- 데이터 백필: `UPDATE crm.customers SET phone = NULL WHERE app_user_id IS NOT NULL AND phone IS NOT NULL` — 실측 대상 1행(제임스, 값이 더미 `01012345678`라 secondary 이동 없이 폐기. 김지안은 이미 NULL).
- CHECK `customers_phone_app_exclusive_check` 추가(백필 뒤).

## 5. 화면

- **상세(드로어) 상태 매트릭스**: 연락처 행은 앱 연결 고객이면 편집 진입 차단+토스트(값은 합성된 앱 번호). `추가 연락처` 행 신설(`statusFieldMeta`에 key `phoneSecondary`, PhoneStatusInput 재사용, 없으면 "미입력").
- **목록**: 연락처 줄에 주 번호, 추가 번호 있으면 병기. 검색 문자열에 secondary 포함.
- 수기 등록 폼은 불변(주 번호만 — 추가 번호는 상세에서).

## 6. 범위 밖(후속 박제)

- **인박스 "고객 생성" 중복 고객**: 수기 고객의 번호와 앱 가입 번호가 다르면 phone 매칭이 못 잡아 "신규(미연결)"로 뜨고, 생성 시 같은 사람 2벌 + 병합 기능 부재. 별도 슬라이스.
- **연결 시 droppedPhone 선택 UI**(v1은 토스트 알림만).
- **Topbar 전역 통합검색이 mock(`initialCustomers`) 검색**(Topbar.tsx:184) — 이번 논의 중 발견한 별건 실버그.
- 추가 연락처 지역번호(02- 등) 입력: PhoneStatusInput이 010 고정 prefix — 주 번호 입력과 동일한 기존 제약, 필요 시 후속.
- 앱 유저 하드 삭제 시 CRM 고객 처리: 앱 팀 계약 필요(FK 미도입 결정 근거 — 연결 유저는 quote_requests/consultations NO ACTION FK가 profiles 삭제를 막아 현재 발생 불가).

## 7. 검증

- 순수 전이 헬퍼 TDD(같음/다름/secondary 점유/null 조합).
- 서버: PATCH 409 게이트·정규화·합성 phone·link 전이 — 라우트 테스트(실채번 픽스처는 registry 선등록).
- 클라: toCustomer 매핑·검색 포함·인박스 byPhone 제외 — 유닛.
- 최종 typecheck·lint·test:unit·test:server·build + 잔재 0.
