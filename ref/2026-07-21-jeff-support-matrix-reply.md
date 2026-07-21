# [제프 → 차선생 CRM] 지원 약정거리·리스기간 조회 API — 회신

작성 2026-07-21 · 회신 대상: `2026-07-21-jeff-support-matrix-request.md` · 기준 main `e45070b`

## 확인 부탁 3건에 대한 답

### 1. 요청 A 계약 — **그대로 수락합니다**

- 엔드포인트/게이트: `GET /api/external/quotes/support-matrix` + `X-API-Key`(기존 external과 동일 키), 파라미터 없음, 전량 반환.
- 응답 shape: 제안하신 `{ ok: true, matrix: [{ lenderCode, productType, leaseTermMonths, annualMileageKm }] }` 그대로 구현합니다. 행 순서는 저희 lender SSOT 순서(mg → bnk → woori → meritz → shinhan → kdbc → im → nh, 리스 먼저·렌트 뒤)로 고정되지만, 순서에 의존하지 말고 `(lenderCode, productType)`로 찾아 쓰시길 권합니다.
- **`null` = 미확정 / `[]` = 전부 미지원** 구분 그대로 갑니다. 저희 쪽 구현·테스트에 이 구분을 명시적으로 박아서(빈 배열로 "통일"하는 리팩터가 불가능하도록 주석+테스트 고정) 지키겠습니다.
- 에러 body는 기존 external 계약(`{ ok:false, errorCode, error }`) 동일, `X-Request-ID` 에코도 동일하게 동작합니다.

첫 응답의 확정/미확정 구성은 이렇게 나갑니다:

| lenderCode | productType | leaseTermMonths | annualMileageKm |
|---|---|---|---|
| mg-capital | operating_lease | [36,48,60] | [10000,20000,30000] |
| bnk-capital | operating_lease | [12,24,36,48,60] | [10000,15000,20000,30000,40000] |
| woori-card | operating_lease | [12,24,36,48,60] | [10000,20000,25000,30000,40000] |
| meritz-capital | operating_lease | [12,24,36,48,60] | 워크북 파생 (아래 참고) |
| shinhan-card | operating_lease | [12,24,36,48,60] | [10000,20000,30000,40000] |
| kdbc-capital / im-capital / nh-capital | operating_lease | null | null |
| mg / meritz / im | long_term_rental | null | null |

**메리츠 행만 특이점 하나**: 메리츠 mileage는 활성 워크북 데이터에서 파생되어 DB를 탑니다. DB 장애·미연결 시 이 API는 500을 내지 않고 **메리츠 mileage만 `null`(미확정)로 강등된 200**을 반환합니다. 그쪽 fail-open 설계와 맞물리도록 의도한 동작이니, "메리츠가 갑자기 null이 됐다" = 저희 DB 쪽 이슈로 이해해 주시면 됩니다. 나머지 4사는 DB 무관하게 항상 확정 배열입니다.

### 2. 시점

구현 플랜은 확정됐고(`docs/superpowers/plans/2026-07-21-support-matrix-api-and-workbook-derivation.md`), **다음 작업 세션에서 구현·머지 예정**입니다. 작업량이 작아(기존 엔진 export 조립 + 라우트 1개) 세션 하나면 됩니다. 머지되면 CF 자동배포로 바로 살아나니, 배포 확인 시점에 다시 알리겠습니다.

### 3. B·C 우선순위 — 저희 판단

- **C를 저희도 원하던 방향이라 먼저 착수합니다.** 지적하신 "②제프 코드 수동 수정" 단계가 저희도 마음에 안 들던 부분입니다. 순서는 위험도 오름차순으로:
  1. **우리카드** (A와 같은 PR로 나감) — 파서에 조정표 파싱 코드가 이미 있어 배선만 하면 되는 상태였습니다. 이게 머지되면 우리카드는 메리츠처럼 **워크북 재import → API 응답 → CRM UI 전 구간 자동**이 됩니다.
  2. 신한 → BNK → MG 순으로 후속. MG만 조정이 테이블이 아니라 잔가사별 수식 체인이라 sweep 재검증이 붙는 큰 작업이고, 시점 약속은 아직 못 드립니다.
  - C가 안 끝난 사(신한/BNK/MG)는 당부하신 대로 **워크북 갱신 시 지원집합 상수를 같이 점검**하는 걸 저희 운영 체크리스트(CLAUDE.md)에 박아두겠습니다.
- **B(산은·iM·농협 + 장기렌트)는 후속 백로그**로 등재했습니다. 말씀대로 이 3사는 지금도 clamp/버킷팅으로 값을 만들어내고 있어서 저희 정책("미지원 값 날조 금지")상으로도 고쳐야 할 대상이 맞습니다. 다만 근거가 Excel이 아니라 포털/harvest 스펙이라 조사가 선행돼야 하고, A만으로 5사 게이트를 켤 수 있다고 하셨으니 급행으로 다루지는 않겠습니다. 착수 시점 잡히면 별도로 알리겠습니다. 그때까지 이 3사 행은 `null`로 유지되고, 완료되면 응답만 배열로 바뀝니다(계약 그대로 — CRM 코드 변경 0).

## 부록 정정 하나

부록에서 "12·24개월 미지원은 MG 한 곳" 확인하신 것 맞습니다. 참고로 MG의 12/24개월은 현재 엔진이 throw하지만, 워크북 자체(잔가 매트릭스)에는 12/24 행이 물리적으로 존재할 수 있어서 **BD22 드롭다운("36,48,60")이 authoritative**입니다 — C 단계에서 term을 데이터 파생으로 바꿀 때도 이 기준으로 갑니다.
