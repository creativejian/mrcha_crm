# CRM 견적 워크벤치 "솔루션 조회" 계산엔진 통합 설계 (2026-07-14)

## 배경

견적 워크벤치 비교카드의 월 납입금 옆 계산기 버튼(`QuoteWorkbench.tsx:454`, aria-label "솔루션 조회")은
현재 자리표시자다("financial-dolim-solution 연결 전 임시 조회 버튼입니다" 토스트). 파트너(제프)의
견적 계산 플랫폼 **financial-dolim-solution**(`/Users/tobedoit/Documents/TypeScript/dolim-solution`,
`github.com/Devguru-J/financial-dolim-solution`, prod `https://mc.mrcha.app`)이 엑셀 워크북 기반
멀티 금융사 계산을 이미 제공하므로, 계산기 클릭 → 파트너 API 호출 → 카드 결과 필드 채움을 실동작화한다.

**이 스펙은 CRM 쪽 작업만 다룬다.** 제프 레포 작업(external 엔드포인트 신설 등)은 보류 — 제프 복귀 시
전달 목록(§10)으로 협의한다. 계산엔진은 원래 "이사님 브레인스토밍 선행" 항목이었으나 유슨생 주도로
설계 확정(2026-07-14), 이사님께는 사후 공유.

선행 정지작업은 전부 소진된 상태: 카드 조건이 CardUiState 객체 1벌(#198), 결과 필드 7종이 시나리오
컬럼(#157), `quotes.entry_mode`에 `"solution"` 값 상주.

## 확정 결정 (유슨생, 2026-07-14)

1. **금융사 select = 파트너 지원사로 교체**: 운용리스 8사(MG·BNK·우리카드·메리츠·신한카드·산은·iM·농협),
   장기렌트 3사(MG·메리츠·iM) — 구매방식에 따라 옵션 동적. 수기 작성 모드도 같은 목록(어휘 SSOT 단일).
   기존 저장 견적의 옛 어휘(우리금융캐피탈·하나캐피탈)는 표시만 유지(데이터 불변).
2. **결과값 편집 허용**: 조회값은 시작점 — 상담사가 협의가·프로모션 반영해 수정 가능(현행 uncontrolled
   input 유지). 조회 당시 원값은 재현성 스냅샷·raw가 보존하므로 수정 여부는 값 비교로 판별.
3. **반납 총비용·인수 총비용·출고 전 납입 = 제프 응답 확장으로 받는다**: 파트너 응답(CanonicalQuoteResult)에
   현재 없음(실측 — 제프 UI의 유일한 파생 = `총비용 = 월납입×기간+잔가`). CRM에 파생 공식을 하드코딩하지
   않는다(계산 권위 = 제프 한 곳). 응답에 오면 채우고(optional 방어 파싱), 확장 전엔 공란 유지(수기 가능).
4. **재현성 스냅샷 저장**: 금융사 요율이 매월 갱신되는 도메인 — "이 월납입금이 어느 워크북 기준인지"를
   시나리오에 남긴다(lenderCode·워크북 버전 라벨·계산 시각).
5. **raw 응답 보존**: 앱 선례(`ai_estimates.partner_raw_response`) 미러 — 디버깅·제프 로그 대조용 jsonb.
6. **구조 = B안(클라 조립 + 서버 인증 릴레이)**: 매핑은 클라 순수 lib(TDD), CRM 서버는 zod 검증 +
   API 키 + X-Request-ID만 붙이는 얇은 릴레이(Gemini 프록시 선례). 서버 계약이 파트너 계약과 1:1이라
   UI 리팩토링에 흔들리지 않는다. 브라우저 직결은 키 노출로 기각.
7. **API 키 = 앱과 공유**(`EXTERNAL_API_KEY` 단일 키 — 파트너 설계 전제 "노출 시 양 팀 동시 교체").
   유슨생이 가져와 CRM `.env.local` + CF Pages **Production** secret(Encrypt, Preview 제외) 등록.
   값은 커밋·PR·메신저·브리프 어디에도 남기지 않는다.

## 파트너 계약 (실측 확정치 — dolim-solution 코드 기준)

### 호출 대상

| 단계 | URL | 인증 |
|---|---|---|
| 개발(현재) | `POST {BASE}/api/quotes/calculate` | 없음(제프 내부용이 공개 상태 — read-only 계산이라 무해) |
| 운영(제프 협의 후) | `POST {BASE}/api/external/quotes/calculate` (신설 요청) | `X-API-Key`(timing-safe, `EXTERNAL_API_KEY`) |

앱 선례(`mr-cha-app/supabase/functions/ai-analyst/external/partner_quote.ts`): `X-API-Key` +
`X-Request-ID`(호출측 UUID — 파트너 로그와 자기 DB 매칭) + 8초 타임아웃 + 실패 outcome 분류.

### 입력 `CanonicalQuoteInput` (CRM이 쓰는 서브셋)

`src/domain/quotes/types.ts` + `shared/contracts/quote.constants.ts` 실측:

- `lenderCode`(8사), `productType`: `"operating_lease" | "long_term_rental"`(그 외 미구현)
- `brand`·`modelName` **필수**, `masterMcCode` optional — mc_code가 오면 엔진이 금융사별 offering을
  해석해 brand/model을 덮어씀. 미취급이면 "미취급" 400
- `ownershipType` **필수**: `"company" | "customer"` — 제프 UI 고정 기본 `"company"` 미러
- `leaseTermMonths`: 12|24|36|48|60 · `annualMileageKm`: 10000~40000(5000 단위)
- `depositAmount`·`upfrontPayment`: 원 단위 정수(％ 수용 없음 — 클라 매퍼가 환산)
- 잔존가치(제프 UI `QuoteRevolutionV2.tsx:197-202`가 정확한 참조):
  최대 → `residualMode:"high"` / ％ → `residualMode:"standard"` + `residualValueRatio`(분율) /
  금액 → `residualMode:"standard"` + `residualAmountOverride`(원)
- `quotedVehiclePrice`(할인 전) + `discountAmount`(원) — 할인 차감은 파트너가 수행(이중 차감 금지)
- `evSubsidyAmount`: 보조금 해당 시 원 단위, 비해당 미전송
- 장기렌트 전용 optional: `releaseMethod`("dealer"|"special")·`maintenanceGrade`("basic"|"vip") —
  v1 미전송(파트너 기본값 사용)

### 출력 `CanonicalQuoteResult` (CRM 소비)

- `monthlyPayment` → 월 납입금
- `rates.annualRateDecimal` → 금리(×100 표시). 예외: 우리카드는 제프 카드도
  `effectiveAnnualRateDecimal`을 메인으로 표시(`QuoteResultCard.tsx:29`) — 동일 규칙 미러
- `residual.rateDecimal`·`residual.amount` → 잔존가치 칸("최대" 모드의 "– 원"이 실채택 잔가로 채워짐)
- `workbookImport.versionLabel` → 재현성 스냅샷
- `warnings[]` → 토스트 병기
- **(제프 확장 후)** 반납 총비용·인수 총비용·출고 전 납입 — optional 방어 파싱으로 선반영 준비
- 실패: `{ok:false, error:"…"}` 400 — 문구를 그대로 토스트("미취급 차종 …" 등)

## 구성

### 1. 어휘·매핑 SSOT — `client/src/lib/solution-quote.ts` (신규, 순수·부작용 0)

- `SOLUTION_LENDERS`: `{ code, label }[]` — 파트너 `LENDER_DISPLAY_NAMES` 8사 미러(순서 = 파트너
  `/api/lenders` 순서). `SOLUTION_RENTAL_LENDER_CODES = ["mg-capital","meritz-capital","im-capital"]`
- `solutionProductTypeOf(purchaseMethod)`: 운용리스→`operating_lease`, 장기렌트→`long_term_rental`,
  그 외 null(계산기 비활성 게이트 `solutionWorkbenchCanQuery`와 정합)
- `buildSolutionQuoteInput(args)`: 카드 조건(CardUiState + 금융사·기간·보증금/선수금 모드·값) +
  가격패널(할인 전 차량가·할인 총액) + 차종(mc_code·브랜드·모델 라벨) → `CanonicalQuoteInput` 서브셋.
  ％→원 환산(기준 = 할인 전 차량가 — 파트너 입력이 할인 전 기준이므로), "없음"→0, 약정거리 문자열
  ("20,000km / 년")→enum 숫자, 잔존 3모드 매핑(§계약), `ownershipType:"company"` 고정
- `parseSolutionQuoteResult(raw)`: 방어 파싱 — 필수(monthlyPayment·rates·residual·workbookImport)
  누락 시 null(실패 취급), 확장 3필드는 optional
- 타입: `SolutionQuoteInput`/`SolutionQuoteResult`/`SolutionSnapshot`
  (서버가 이 파일을 import해도 되는 순수 경계 — #190 규칙)

### 2. 서버 릴레이 — `POST /api/solution/calculate` (신규 라우트)

- 기존 auth 체인(401→dealerWriteGate 403→db) 그대로 — dealer는 전역 게이트가 차단(fail-closed 수용,
  dealer는 견적 쓰기 자체가 차단된 역할)
- zod: 파트너 계약 서브셋 검증(lenderCode enum·term enum·음수 금액 거부 등) — 실패 400
- env `PARTNER_QUOTE_API_URL` 미설정 → **503 + 명시 문구**(fail-loud — 조용한 실패 금지),
  `PARTNER_QUOTE_API_KEY` 설정 시에만 `X-API-Key` 부착(개발 무인증 단계 수용, fail-open 아님 —
  URL이 스위치)
- `X-Request-ID: crm-<uuid>` 생성·전달 + 응답 tail 로그(`[solution] calculate lender=… ok=… <ms>`)
- 8초 타임아웃(AbortSignal — 앱 미러). ⚠️fetch는 지역 변수 plain call(Workers Illegal invocation 함정)
- 파트너 4xx/5xx는 `{ok:false,error}` 패스스루(상태코드 보존), 네트워크/타임아웃은 502/504 구분

### 3. 워크벤치 배선 — `useQuoteWorkbench` + `QuoteWorkbench.tsx`

- 금융사 select: 하드코딩 3사 제거 → `SOLUTION_LENDERS` 소비, 구매방식이 장기렌트면 렌트 3사만.
  select는 uncontrolled(defaultValue) 유지 — Safari 함정 무관 경로
- 계산기 클릭: 카드별 로딩 상태(연타 방지 disabled) → 매퍼 조립 → 릴레이 호출 → 성공 시
  월 납입금·금리·잔존가치 input 값 갱신(uncontrolled라 DOM 갱신 헬퍼 — 기존 프리필 패턴 재사용) +
  스냅샷·raw를 카드 상태에 보관 → 조건 변경 후 재조회 시 덮어씀
- mc_code 부재(카탈로그 외 차종) → 계산기 disabled + title 안내
- 실패 → 파트너 문구 토스트, 카드 값 불변

### 4. 저장 확장 — 마이그 0031 + 저장 경로

`crm.quote_scenarios`에 nullable 4컬럼(전부 additive — 기존 행·수기 시나리오는 null):

| 컬럼 | 타입 | 값 |
|---|---|---|
| `solution_lender_code` | text | 계산에 쓴 lenderCode |
| `solution_workbook_version` | text | `workbookImport.versionLabel` |
| `solution_calculated_at` | timestamptz | 조회 시각 |
| `solution_raw` | jsonb | 파트너 응답 raw 통째(앱 `partner_raw_response` 선례) |

- `db:generate` → `db:migrate`(schemaFilter crm — `db:push` 금지)
- 서버 시나리오 zod·insert/update + 클라 저장 payload에 optional 4필드 동봉. 저장 후 수기 편집이
  있어도 스냅샷은 "마지막 조회" 기록으로 유지(값 비교로 편집 판별 — 결정 2)

## 에러 처리 요약

| 상황 | 표면화 |
|---|---|
| 미취급 차종/금융사(파트너 400) | 파트너 `error` 문구 그대로 토스트, 카드 불변 |
| 타임아웃 8s / 네트워크 | "계산 서버가 응답하지 않습니다" 토스트(504/502) |
| env 미설정 | 서버 503 "솔루션 연결이 설정되지 않았습니다" |
| zod 400 | 매퍼 버그 신호 — 문구 표면화(원리적으로 도달 불가) |
| dealer | 전역 dealerWriteGate 403(기존 계약) |
| 응답 형태 이탈 | `parseSolutionQuoteResult` null → 실패 토스트(raw 미저장) |

## 환경/전환

- env: `PARTNER_QUOTE_API_URL`(예: dev `https://mc.mrcha.app/api/quotes/calculate` → 제프 머지 후
  `…/api/external/quotes/calculate`) + `PARTNER_QUOTE_API_KEY`(optional — external 전환 시 필수)
- `.env.example`에 자리 추가(값 없음). CF Pages Production secret 등록은 유슨생(결정 7)
- 전환 = env 교체만, 코드 불변(GEMINI_PROXY_URL 선례)

## 검증

- 유닛(vitest, TDD): 매퍼(％→원 환산·잔존 3모드·약정거리 변환·"없음" 0·렌트 금융사 좁힘)·파서(방어
  파싱·확장 필드 optional)·어휘 SSOT
- 서버(bun:test): zod 게이트·키 헤더 조건부 부착·X-Request-ID·503 fail-loud·타임아웃(fetchImpl 주입)
- 4종 + 마이그 0031 실 DB 적용 + 격리 스택 브라우저 스모크: 실 고객 견적 워크벤치에서 솔루션 조회
  모드 → 계산기 클릭 → **파트너 prod 실계산**(read-only) → 카드 채움 실측 → 저장 → psql 스냅샷·raw
  대조 → 재진입 복원 → 스모크 견적 UI 삭제 원복(임베딩 고아 방지 — psql 직접 삭제 금지)
- 실측 대조: 같은 조건을 제프 playground에 넣어 월납입 일치 확인(파리티 증거 1건)

## 범위 밖 (의도)

- **제프 레포 작업 전부**(external 엔드포인트·응답 확장) — §10 전달 목록으로 협의
- 금융리스·할부·오토론(파트너 미구현 — 수기 작성 모드가 담당, 기존 게이트 유지)
- 8사 일괄 비교(최저가 찾기 — 앱 cheapest 유스케이스, CRM은 상담사가 금융사를 지정하는 흐름)
- 조건 변경 시 자동 재계산(수동 트리거만 — 파트너 서버 부하·연타 고려, 실사용 관찰 후)
- 장기렌트 `releaseMethod`/`maintenanceGrade` 노출(v1 파트너 기본값 — 필요 시 후속)

## §10. 제프 전달 목록 — ✅ **전량 종결(2026-07-14 밤)**

1. ~~`POST /api/external/quotes/calculate` 신설~~ → ✅ **완료·배포**(제프 레포 `0bc7dda` — 내부 핸들러를
   `computeCalculateQuoteResponse`로 추출해 내부/external 공유, body 계약("미취급" 400 문구 포함)
   **구현상 동일 보장**. `createApiKeyMiddleware(EXTERNAL_API_KEY)` 게이트 + X-Request-ID echo).
   **CRM 전환도 완료**: 내부 회귀 0·무키 401/유키 200·body 동일 검증 → `.env.local`+CF Pages
   Production secrets(URL→external·KEY 등록)+재배포(`e812de3`) → crm.mrcha.app 인증 호출 200 실계산.
2. ~~응답 확장 3필드~~ — **개정 1로 불필요**(CRM 파생으로 대체, 요청 철회)
3. ~~자동차세 토글 의미 확인~~ → ✅ **회신 박제**: **운용리스 = 자동차세 별도**(엔진에 개념 없음 —
   월납입은 PMT만) / **장기렌트 = 월요금에 내장**(MG CW16·메리츠 EG8·iM carTaxY 월분 합산) /
   calculate 입력 스키마에 자동차세 필드 없음(external 동일) → **CRM 토글 = API 미전송·표시용이 정답
   확정**. (후속 아이디어 저우선: 솔루션 조회로 채운 카드는 토글을 사실값 자동 세팅 — 실사용 관찰 후)
4. ~~키 공유 고지~~ → ✅ 제프 반영 확인(EXTERNAL_API_KEY 공유 전제 그대로 — 노출 시 양 팀 동시 교체)
5. ~~X-Request-ID 형식~~ → ✅ `crm-<uuid>`가 기존 REQUEST_ID_PATTERN 무변경 통과 — echo 테스트로 고정.
   미취급 문구는 공유 핸들러로 구조 보장 + 8콜 병렬 패턴 무상태 OK 확인

## 이사님 사후 공유 항목

- 계산엔진을 파트너 API 연동으로 확정(자체 엔진 구축 아님 — 제프 플랫폼이 SSOT)
- 금융사 어휘를 파트너 지원 8사로 교체(기존 목업 어휘 소멸)
- ~~반납/인수/출고 전 납입은 제프 응답 확장 대기(그 전까지 수기)~~ → **개정 1로 대체: CRM 파생(읽기 전용)**
- **금리 의미론 변경(개정 1)**: 금융사 표면금리가 아니라 **리스계산기 실질(내재) 금리** — 카드·앱 표시값이 달라짐

---

## 개정 1 — 계산기 UX·파생 4필드·어휘 구조 (2026-07-14, 유슨생 실기 피드백·확정)

Task 1~5 구현 후 유슨생 실기 검토로 원 결정 1·3을 아래로 **대체**한다. 근거 조사 2건 완료:
앱 리스계산기 공식(`mr-cha-app/supabase/functions/ai-analyst/utils/lease_calc.ts` — 수학은 Deno 서버 측) ·
워크벤치 4필드 현행 배선(uncontrolled 수기 입력 + 시나리오 4컬럼 + 앱카드 라벨 소비).

### R1. 계산기 버튼 3분기 (카드별)

1. **금융사 미선택 + 클릭** → **파트너 지원 금융사 모달**(구매방식별 — 운용리스 8사/장기렌트 3사) →
   하나 선택 → 카드 금융사 select 값 세팅 + **선택 즉시 그 금융사로 계산 실행** → 월 납입금 등 채움
2. **파트너 지원 금융사 선택됨 + 클릭** → 모달 없이 바로 계산(기존 구현)
3. **파트너 미지원 금융사 선택됨 + 클릭**(예: 레거시 "우리금융캐피탈") → 계산 없이 경고 토스트
   ("「X」은(는) 솔루션 미취급 금융사입니다 — 수기로 작성해 주세요")

### R2. 금융사 어휘 = CRM 소유 상위집합 구조 (유슨생: "제프랑 맞추되 나중에 수동 추가 가능하게")

- 시작 어휘 = 파트너와 동일(현행 유지). `CRM_EXTRA_LENDERS`(초기 **빈 배열**, `solution-quote.ts`)에
  한 줄 추가로 **수기 전용 금융사** 확장 — select에는 노출되지만 계산기는 R1-3 경고.
- select 옵션 = 파트너 목록(구매방식별) + `CRM_EXTRA_LENDERS` + 레거시 저장값(기존 로직 유지).
- 파트너 지원 판정은 select 옵션이 아니라 **계산기 클릭 시점**(경고)으로 이동.

### R3. 결과 4필드 = 읽기 전용 파생값 (원 결정 3 "제프 응답 확장 대기" 폐기)

반납 총비용·인수 총비용·출고 전 납입·금리는 수기 입력 불가(readOnly), **월 납입금이 결정되면**
(솔루션 조회든 수기 타이핑이든) 카드 조건에서 자동 파생·표시한다. 산식(유슨생 확정):

| 필드 | 산식 |
|---|---|
| 반납 총비용 | 월납입 × 기간 + 선수금 |
| 인수 총비용 | 월납입 × 기간 + **잔존가치 금액** + 선수금 |
| 출고 전 납입 | 보증금 + 선수금 + **기타비용**(= 가격패널 파생 `otherCost` = 탁송료+부대비용 — "취득원가 불포함, 고객 부담" 기존 라벨과 일치) |
| 금리 | **앱 리스계산기 공식 이식**(아래) |

- **금리 = Excel RATE 역산(Newton-Raphson secant)**, 앱 `lease_calc.ts` 원본 그대로 이식:
  `PV = −(취득원가 − 선수금)` · `FV = 잔존가치 금액` · `PMT = 월납입` · `n = 기간` · type 0 ·
  `연이율 = 월이율 × 1200`(소수 4자리). **선수금은 PV 차감, 보증금은 PV 미포함**(앱 의도적 비대칭).
  검증 벡터(앱 test_math.ts): n=60·월납입 1,200,000·취득원가 75,000,000·잔가 35,000,000·선수금
  10,000,000 → **연 16.0840%**. ⚠️ **의미론 = 실질(내재) 금리** — 금융사 표면금리(제프 응답 5.32%류)와
  다른 값. 솔루션 조회 후에도 제프 금리가 아니라 이 공식으로 채운다(제프 금리·확장 필드는
  `solution_raw` 스냅샷에만 보존, 카드 채움 경로 제거).
- **잔존가치 금액 해석**: 금액 모드 = 입력값 / % 모드 = % × 할인 전 차량가(base+option — 솔루션 입력
  환산과 동일 기준) / 최대 모드 = 솔루션 조회가 채운 실채택 잔가(조회 전 미정 → 인수·금리 공란).
- **취득원가** = 가격패널 파생 `acquisitionCost`(`quote-pricing.ts` SSOT 그대로 소비). 보조금 차감은
  v1 미반영(실기 관찰 후 후속).
- 파생 불능(월납입 0·잔가 미정·비유한 수렴)이면 해당 필드 "0"/공란 — 저장은 기존 `nz()` 규칙이 null 처리.
- 저장 계약 불변: 파생값이 기존 시나리오 4컬럼(`total_return_cost`·`total_takeover_cost`·
  `due_at_delivery`·`interest_rate`)에 그대로 실림(추출 경로 무변경) → 앱카드 라벨 파이프라인 불변.

### 개정이 무효화하는 것 (개정 1)

- 제프 전달 목록 §10-2(응답 확장 3필드) — **불필요해짐**(CRM 파생으로 대체, 전달 목록에서 제외)
- `solutionDisplayRatePct`(우리카드 유효금리 표시 규칙) — 카드 채움 경로에서 제거(파서의 금리 필드는
  raw 스냅샷 보존용으로 잔존)

---

## 개정 2 — 금융사 선택 모달 → 일괄 조회 랭킹 모달 (2026-07-14, 유슨생 확정)

개정 1 R1-1의 "금융사 리스트 모달"을 **제프 솔루션의 랭킹 리스트 UX**로 대체한다(제프 UI 스크린샷 기준,
제프 폴더 참조·이식 허용 — 유슨생 승인). 조사 실측: 제프 랭킹 UI = 배치 엔드포인트가 아니라
**금융사별 `POST /api/quotes/calculate` 병렬 호출**(`useMultiQuote` — Promise.allSettled, 개별 도착
순 렌더) → **CRM 서버 변경 0**, 기존 릴레이를 금융사 수만큼 병렬 호출.

### R4. 동작

1. 계산기 클릭 + 금융사 미선택 → 모달 오픈과 **동시에** 지원 금융사 전체(구매방식별 8/3) 병렬 계산.
   로딩 = 헤더 스피너("견적 조회 중…") + 결과 행 개별 도착 순 등장(제프 미러 — 스켈레톤 없음).
2. **랭킹 행**(제프 `QuoteResultRow` 이식): 순위 + 카테고리 뱃지 + 로고 + 금융사명 + 금리 배지 +
   ⚠️(warnings tooltip) + 월납입(우측 강조) + 1위 대비 +차액(빨강) + "잔존가치 N원 (p%) | 총 비용 N원".
3. **행 클릭 = 선택**: 카드 금융사 select 세팅 + 월납입·잔가(최대 모드) 채움 + 그 금융사 raw로 스냅샷
   → 파생 4필드 자동 계산 → 모달 닫기. (직접 계산 분기·미지원 경고 분기는 개정 1 그대로.)
4. **정렬**: 기본 월 납입 순, 헤더 토글로 금리 순/잔존가치 순/총 비용 순 전환(제프 4종 미러).
5. **미취급·실패 금융사 = 조용히 제외**(제프 미러 — 실패 footer 없음). 전부 실패 시 "조회 결과가
   없습니다" + 기존 수기 안내 문구 유지.

### R4 계산 규칙 (제프 `sortQuotes.ts`·`ConditionCards.tsx` 실측 미러)

- **금리**: woori-card만 `effectiveAnnualRateDecimal`, 그 외 `annualRateDecimal` (×100, toFixed(2))
- **월납입 표시값**: 운용리스 = `Math.ceil(raw/100)*100`(100원 올림) / 장기렌트 = raw 그대로(VAT 기포함).
  **행 클릭 시 카드에도 이 표시값을 채운다**(모달↔카드 일치 — 원값은 solution_raw가 보존)
- **총 비용** = 표시 월납입 × 기간 + 잔가 금액
- **뱃지** = 집합 전체 min/max 대비 strict `===`(동률 복수 부여): 최저 월납입(red)/최저 금리(green)/
  최대 잔존가치(gray)/최저 총 비용(green)
- **+차액** = 월 납입 순 정렬일 때만, 1위 제외 행에 `+{monthly − min}` 빨강
- 미취급 판별: 파트너 400 문구 패턴(제프 NOT_AVAILABLE_PATTERNS 미러 — "미취급"/"없습니다" 등)

### R4 구성

- **로고 에셋**: 제프 `client/src/assets/lenders/` 8파일(mg/bnk/woori/meritz/shinhan.jpg·kdbc/im.png·
  nhcap.svg)을 CRM `client/src/assets/lenders/`로 복사, lenderCode 매핑(금융사 공식 마크 — 제프와
  동일한 내부 B2B 용도)
- **순수 랭킹 lib**(TDD): `client/src/lib/solution-ranking.ts` — entry 조립(표시 라운딩·금리 선택)·
  정렬 4종·stats/뱃지·차액. 파트너 응답 raw → 행 데이터 변환까지 순수로
- **모달 컴포넌트**: `SolutionLenderRankingModal`(신규 파일) — 병렬 fetch 상태 자체 소유(제프
  useMultiQuote 미러), 훅은 조건 조립 함수(`buildArgs` 공유)·선택 콜백만 제공. 채움 로직은 직접
  계산 경로와 공유 함수로 통일
- 스타일: 제프 원본이 Tailwind 유틸리티(CRM 빌드에 Tailwind 상주) — 유틸리티 이식을 기본으로 하되
  레포 관례와 충돌 시 워크벤치 CSS로 번역(구현 판단·보고)

### 범위 밖(개정 2)

- 배치 서버 엔드포인트(제프 cheapest 확장) — N 병렬로 충분, 제프 협의 불요
- 실패 금융사 표면화("N사 미취급" footer) — 제프도 미표시, 실사용 관찰 후
