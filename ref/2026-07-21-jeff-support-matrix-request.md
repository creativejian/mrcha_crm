# [차선생 CRM → 제프] 지원 약정거리·리스기간 조회 API 요청

작성 2026-07-21 · 기준 제프 main `e45070b`

## 요약

PR #73·#76·#78로 미지원 약정거리·리스기간이 **미취급 throw**로 정리된 것 확인했습니다. 값 날조가 사라진 건 저희 쪽에도 그대로 이득입니다.

다만 저희 견적 워크벤치는 상담사가 **금융사·기간·약정거리를 직접 고르는 화면**이라, 지금은 미지원 조합을 고를 수 있고 **조회 버튼을 눌러야** 미취급 사유를 알게 됩니다. 고르기 전에 막으려면 CRM이 사별 지원집합을 알아야 하는데, 현재 external API 4종(`quotes/cheapest`·`quotes/calculate`·`catalog/dealers`·`catalog/bnk-dealers`)에는 그걸 조회할 경로가 없습니다.

**요청은 3건입니다 — A(필수) / B(필요) / C(권고, 제프 우선순위 판단).**

---

## 요청 A (필수) — 지원집합 조회 API 신설

### 엔드포인트

```
GET /api/external/quotes/support-matrix
X-API-Key: <EXTERNAL_API_KEY>          # 기존 external 3종과 동일 게이트
```

파라미터 없음(전량 반환). 저희가 세션당 1회 받아 캐시합니다.

### 응답 계약

```jsonc
200 {
  "ok": true,
  "matrix": [
    { "lenderCode": "mg-capital",   "productType": "operating_lease",
      "leaseTermMonths": [36, 48, 60],
      "annualMileageKm": [10000, 20000, 30000] },

    { "lenderCode": "bnk-capital",  "productType": "operating_lease",
      "leaseTermMonths": [12, 24, 36, 48, 60],
      "annualMileageKm": [10000, 15000, 20000, 30000, 40000] },

    { "lenderCode": "kdbc-capital", "productType": "operating_lease",
      "leaseTermMonths": null,       // ← 미확정
      "annualMileageKm": null },

    { "lenderCode": "mg-capital",   "productType": "long_term_rental",
      "leaseTermMonths": null,
      "annualMileageKm": null }
    // … 8사 × 취급 productType
  ]
}
```

에러 body는 기존 external 계약(`{ ok:false, errorCode, error }`)과 동일하면 됩니다.

### 🔴 `null`의 의미 — 이게 이 요청의 핵심입니다

- **배열** = 확정된 지원집합. CRM이 그 밖의 값을 UI에서 막습니다.
- **`null`** = **미확정**(게이트 미착수). CRM은 게이트를 걸지 않고 전부 통과시킵니다.
- **빈 배열 `[]`** = "전부 미지원". 의미가 정반대이니 미확정에 쓰지 말아 주세요.

이 구분이 있어야 **Phase B 미착수 3사(산은·iM·농협)와 장기렌트를 지금 그대로 두고도 API를 먼저 받을 수 있습니다.** 나중에 Phase B가 끝나면 `null` → 배열로 응답만 바뀌고, **CRM은 코드 변경 0으로 자동 확장**됩니다.

### 이미 있는 재료 (새로 만들 게 거의 없습니다)

PR #78에서 각 엔진이 지원집합을 이미 export하고 있어, 그대로 모아 직렬화하면 됩니다.

| 금융사 | 심볼 | 위치 |
|---|---|---|
| MG | `MG_SUPPORTED_MILEAGE_KM` / `MG_SUPPORTED_TERM_MONTHS` | `src/domain/lenders/mg-capital/operating-lease-service.ts` |
| BNK | `BNK_SUPPORTED_MILEAGE_KM` | `bnk-capital/operating-lease-service.ts` |
| 우리 | `WOORI_SUPPORTED_MILEAGE_KM` | `woori-card/operating-lease-service.ts` |
| 신한 | `SHINHAN_SUPPORTED_MILEAGE_KM` | `shinhan-card/operating-lease-service.ts` |
| 메리츠 | `meritzSupportedMileageKm(extras)` | `meritz-capital/operating-lease-service.ts` |

### 구현 시 걸릴 만한 것 2가지

1. **term은 MG만 export되어 있습니다.** 나머지 4사는 게이트가 없어 별도 상수가 없는데, `docs/mileage-support-matrix-2026-07-19.md` §2 기준 전부 `{12,24,36,48,60}`이니 글로벌 `LEASE_TERMS`(`shared/contracts/quote.constants.ts:5`)를 그대로 실으시면 됩니다.

2. **메리츠만 `MeritzWorkbookExtras` 인자가 필요합니다**(워크북 데이터 주도라 DB 로드 필요). 나머지 4사는 모듈 상수라 DB 없이 응답 가능합니다. DB 연결이 없는 환경에서는 메리츠만 `null`로 떨어뜨려도 저희는 안전하게 동작합니다.

---

## 요청 B — Phase B 완료 (산은·iM·농협) + 장기렌트

`docs/mileage-support-matrix-2026-07-19.md` 부록에 조사만 되고 미착수로 남아 있는 건입니다.

| 대상 | 현재 |
|---|---|
| NH 리스 | `pickNhcapMileageCode` 최근접 clamp(15K→10/20K) + 매트릭스 미스 시 `'01'`(20K) fallback |
| iM 리스 | `mileageLabel` `<=` 버킷팅(25K→30K, 35K→40K) |
| iM 렌트 | `findValue(...) ?? 0` |
| 산은(KDBC) | PR #73에서 마일리지 잔가 fallback/clamp 제거 — term 축 미조사 |
| 장기렌트 전반 | `unsupportedMileageError`/`unsupportedLeaseTermError` 호출 0건 |

**A만 있어도 저희는 5사 게이트를 켤 수 있어 급하진 않습니다.** 다만 이 3사는 지금도 값을 지어내는 중이라(clamp/버킷팅), 저희가 그걸 정상 견적으로 오인해 고객에게 내보낼 수 있다는 점만 공유드립니다. 우선순위는 그쪽에서 정해 주세요.

---

## 요청 C (권고 — 필수 아님) — 지원집합을 워크북 파생으로

지금 조정테이블이 **소스코드 하드코딩**이라, 금융사가 실제로 상품을 바꿔도 코드를 고치기 전까지는 반영되지 않습니다.

```ts
// bnk-capital/operating-lease-service.ts:144
const BNK_MILEAGE_ADJUSTMENTS: Record<number, number> = { 10000: 0.02, 15000: 0.01, … };
// mg-capital/operating-lease-service.ts:126
export const MG_SUPPORTED_TERM_MONTHS = new Set([36, 48, 60]);
```

**메리츠는 이미 워크북 파생**이라(`parseMileageResidualAdjustments()` → `mileageResidualAdjustments`), 재import만으로 자동 갱신됩니다. 나머지 4사도 같은 형태가 되면 **워크북 갱신 → API 응답 → CRM UI**까지 전 구간이 자동이 됩니다.

다만 이 테이블들은 **계산 자체에 쓰이는 값**이라 파서로 옮기면 회귀 검증(sweep)이 따라와야 하는 작업으로 보입니다. 저희 쪽 요구는 아니고, **A의 계약만 지켜지면 내부가 상수든 DB든 CRM은 무관**합니다. 판단은 그쪽 몫입니다.

> 참고: 정규 파서에 `dataValidation`(드롭다운) 파싱은 현재 0건이라, 이번 매트릭스 확정에 쓰신 zip 직접 파싱을 파이프라인에 넣는 것도 한 방법일 듯합니다.

**C를 안 하시는 경우 부탁 하나** — 워크북을 갱신하실 때 지원집합 상수도 같이 봐 주세요. 저희 UI가 그 값을 그대로 신뢰해 버튼을 막습니다.

---

## CRM 쪽 대응 (참고 — 그쪽 작업 아님)

- **API 실패 시 fail-open**: 게이트를 걸지 않고 전부 노출합니다. 이 API 장애로 저희 견적 작성이 멈추는 일은 없습니다.
- **게이트는 UX 개선일 뿐, 정합성 방어선이 아닙니다.** 진짜 방어선은 그쪽 엔진의 미취급 throw이고, 저희는 그 400 문구를 지금도 그대로 표면화하고 있습니다. **A가 늦어도 잘못된 값이 나가진 않습니다.**
- 캐시는 세션 단위(브라우저 새로고침 시 갱신)로 둘 예정입니다.
- 계산기 모달(전사 병렬 조회)은 기준 금융사가 없어 게이트 대상이 아닙니다 — 지금처럼 미취급 사가 결과에서 조용히 빠지는 동작을 유지합니다.

---

## 확인 부탁

1. **A 계약(특히 `null` = 미확정)** 이대로 괜찮을까요? 응답 shape에 조정 의견 있으시면 저희가 맞추겠습니다.
2. **A 대략 언제쯤** 가능할지 — 저희 UI 작업 순서를 잡는 데만 쓰겠습니다.
3. **B·C 우선순위** — 그쪽에서 정해 주시면 저희는 A만 받아 먼저 진행합니다.

---

### 부록 — 저희가 참조한 사실 (확인용)

- 매트릭스 원본: `docs/mileage-support-matrix-2026-07-19.md`
- 미취급 에러 SSOT: `shared/contracts/quote-support.ts`
- 미취급 응답 = `computeCalculateQuoteResponse`의 catch → **400 + `미취급` 포함 문구** (`src/routes/quote-core.ts`)
- **12·24개월 미지원은 MG 한 곳**이고 BNK·우리·신한·메리츠는 5개 기간 전부 지원 — 저희가 처음에 "BNK가 12개월 미지원"으로 잘못 알고 있었는데, 문서 보고 정정했습니다.
