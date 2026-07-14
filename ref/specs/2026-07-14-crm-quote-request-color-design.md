# 앱 견적요청 컬러 CRM 반영 — 설계

작성: 2026-07-14 · 유슨생 · 브랜치 `feat/crm-quote-request-color`

## 배경

앱 견적요청(`public.quote_requests`)에 **희망 컬러**가 추가됐다. 사용자는 컬러 단계에서 외장·내장 컬러를
직접 고르거나(`selected`), 정하지 않거나(`undecided`), 무관(`no_preference`), 또는 컬러 데이터가 없는
트림에서 "생각해둔 컬러가 있다"(`consultation`)를 선택할 수 있다.

이 컬러 상태는 지금까지 CRM에 전혀 반영되지 않았다(#158 승격 시드가 기간·보증금·선수금까지만 다뤘고
컬러 컬럼 자체가 DB에 없었다). 앱 팀이 컬럼·RPC 배포를 완료해(아래 계약) 이제 CRM이 소비할 수 있다.

## 계약 (앱 완료 — 2026-07-14 실측 확인)

`public.quote_requests` 컬러 7컬럼 + CHECK 제약:

```
color_preference_mode text  CHECK (in 'undecided','no_preference','selected','consultation')
exterior_color_id   bigint  -- → catalog.colors.id
exterior_color_name text
exterior_color_hex  text
interior_color_id   bigint
interior_color_name text
interior_color_hex  text
```

RPC `create_quote_with_options`에 `p_color_*` 7개 파라미터 추가. **본문에 서버 방어 CASE** —
`color_preference_mode != 'selected'`이면 컬러 6필드를 무조건 null로 강제한다. 즉 `selected`가 아닌
mode에서 컬러 값이 채워진 행은 DB 레벨에서 발생하지 않는다.

- `selected`: 실제 선택한 외장·내장만 저장. 한쪽만 골랐으면 반대쪽 3필드 null.
- `undecided`·`no_preference`·`consultation`: 컬러 6필드 전부 null.
- 기존 행(마이그레이션 이전): `color_preference_mode = null`. **백필 없음.**

CRM은 이 계약을 소비만 한다. `public` DDL은 앱 관할(불가침).

## 표시 규칙

| `color_preference_mode` | 카드 라벨 | 워크벤치 프리필 |
|---|---|---|
| `undecided` | 컬러 미정 | — |
| `no_preference` | 컬러 무관 | — |
| `selected` | 컬러 지정 | 외장·내장 id 매칭 프리필 |
| `consultation` | 희망 컬러 있음 | — |
| `null` (기존 행) | **라벨 숨김** | — |

**카드 표시 위치**: 앱 견적요청 카드(`NeedsDashboard.tsx`) 첫 줄 끝에 이어붙인다.

```
운용리스 · 옵션 없음 · 컬러 지정
60개월 · 선수금
```

- 구분자는 기존과 동일한 ` · ` 하나. dot(•) 없음.
- `colorLabel`이 null(기존 행)이면 아무것도 붙이지 않는다(구분자도 없음).

## 변경 파일 (세로 슬라이스, 한 PR)

### 1. `src/db/public-app.ts` — drizzle 미러

`quoteRequests` pgTable에 컬러 7컬럼 추가(read 전용 미러). `deposit_ratio`가 컬럼 존재에도
미러에 누락됐던 선례가 있으니 7개 전부 명시한다. 이 파일은 메인 drizzle.config 대상이 아니라
마이그레이션을 생성하지 않는다(앱 소유 스키마의 타입 미러일 뿐).

### 2. `src/db/queries/quote-requests.ts` — 서버 쿼리

- `AppQuoteRequestRow` 타입 + `QuoteRequestBaseRow` 타입 + `quoteRequestBaseSelect` + map에
  컬러 필드 배선(`colorPreferenceMode`, `exteriorColorId/Name/Hex`, `interiorColorId/Name/Hex`).
  base select ↔ base row ↔ map은 1:1로 맞춰야 한다(파일 주석 규약).
- `getQuoteRequestDetail`(승격 프리필 응답)에 컬러 필드 추가. `selected`일 때 외장·내장 id·name·hex를
  담고, 그 외/null이면 컬러 필드 null(DB가 이미 null로 저장하므로 별도 게이트 불필요 —
  값을 그대로 통과시키면 계약이 자동 성립).

### 3. `client/src/data/quote-request-labels.ts` — 어휘 SSOT

`COLOR_PREFERENCE_MODE_LABEL` 추가(클라·서버 공용, 앱 Dart `QuoteColorPreferenceMode`와 어휘 일치):

```ts
export const COLOR_PREFERENCE_MODE_LABEL: Record<string, string> = {
  undecided: "컬러 미정",
  no_preference: "컬러 무관",
  selected: "컬러 지정",
  consultation: "희망 컬러 있음",
};
```

### 4. `client/src/lib/quote-requests.ts` — 카드 매핑 + 프리필

- 클라 `AppQuoteRequestRow`에 컬러 필드(서버 타입과 대칭).
- `AppQuoteRequest`에 `colorLabel: string | null`. null이면 카드가 라벨을 숨긴다.
- `colorLabelOf(mode: string | null): string | null` 헬퍼 — `depositLabelOf` 옆에 둔다.
  mode가 null이면 null, `COLOR_PREFERENCE_MODE_LABEL[mode] ?? null`(미지의 값도 null로 방어).
- `toAppQuoteRequest`에 `colorLabel: colorLabelOf(row.colorPreferenceMode)` 배선.
- `QuoteRequestPrefill`에 `exteriorColorId: number | null`, `interiorColorId: number | null` 추가.
- `fetchQuoteRequestDetail`이 응답의 컬러 id를 prefill로 매핑(name/hex는 프리필에 불필요 —
  워크벤치가 catalog `detail.colors`에서 id로 `TrimColor` 객체를 찾으므로 name/hex는 거기서 온다).

### 5. `client/src/components/customer-detail/NeedsDashboard.tsx` — 카드 렌더

첫 줄(`{req.paymentLabel} · 옵션 {req.optionLabel}`) 뒤에 `req.colorLabel`이 있으면 ` · {colorLabel}`을
이어붙인다. null이면 붙이지 않는다.

### 6. `client/src/components/customer-detail/hooks/useQuoteWorkbench.ts` — 승격 프리필

`quoteRequestPrefill` 상태(현재 `{ trimId, optionIds }`)에 `exteriorColorId`, `interiorColorId` 추가.
`openWorkbenchForQuoteRequest`(line 165)에서 `detail`의 컬러 id를 담는다.

`applyTrimToPricing`(트림 로드 후 프리필 단일 지점)의 컬러 프리필(line 567-568)을 **옵션(line 566)과
대칭으로** 확장한다 — 현재 컬러는 수정-재진입(`editPrefill`)만 프리필하는데, 승격(`quoteRequestPrefill`)도
폴백에 얹는다:

```ts
const colorFrom = prefill ?? qrPrefill; // 둘 다 exteriorColorId/interiorColorId 보유
setExteriorColor(colorFrom ? detail.colors.find((c) => c.id === colorFrom.exteriorColorId) ?? null : null);
setInteriorColor(colorFrom ? detail.colors.find((c) => c.id === colorFrom.interiorColorId) ?? null : null);
```

`selected`가 아니면 컬러 id가 null이라 `find`가 undefined → `?? null`로 자동 방어(별도 mode 분기 불필요).
`ColorPicker`가 이미 `TrimColor`의 hexValue로 스와치를 렌더하므로 워크벤치 컬러 표시는 자동으로 채워진다.

## 테스트

- **`client/src/lib/quote-requests.test.ts`**(유닛): `colorLabelOf` 5갈래(4 mode + null) · `toAppQuoteRequest`가
  `colorLabel`을 붙이는지 · 기존 null 행은 `colorLabel === null`.
- **`src/routes/quote-requests.test.ts`**(서버, 실 DB): 쿼리 map이 컬러 필드를 반환하는지 ·
  `getQuoteRequestDetail`이 `selected` 행의 컬러 id를 담는지. 픽스처는 랜덤 서픽스 + `afterAll` 정리
  (공유 master — 잔재 tripwire 규약). 컬러 있는 견적요청 행을 픽스처로 만들되 접두사 registry 확인.
- **`useQuoteWorkbench.residue.test.tsx`**(유닛): 승격 프리필이 컬러 id로 `detail.colors`에서 찾아
  `exteriorColor`/`interiorColor`를 세팅하는지(기존 mock에 컬러 필드 추가).

## 의도적 제외

- **카드 스와치(색 점)**: 이사님 위치 분리 결정 — 카드는 상태 텍스트, 컬러 실물은 워크벤치(`ColorPicker`).
- **`code`(예: C5Y)**: `crm.quotes`도 미보유. 필요 시 catalog 조인으로 해석 가능.
- **기존 null 행 백필**: 계약상 백필 없음. 라벨 숨김 폴백으로 영구 커버.
- **`consultation` 자유입력 컬러명**: 앱이 구조화 값을 안 받으므로 CRM도 표시할 값이 없다("희망 컬러 있음"만).

## Open Questions

없음. 계약·표시·배선 전부 확정.
