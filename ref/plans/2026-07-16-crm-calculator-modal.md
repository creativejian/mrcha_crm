# 전역 계산기 모달 (값어림 계산 이식) — 실행 계획

Spec(결정·배선표 SSOT): `ref/specs/2026-07-16-crm-calculator-modal-design.md`
원본: `/Users/tobedoit/Documents/TypeScript/dolim-solution/client/src/` (이하 "제프")

## 파일 배치 (인터페이스 핀 — 태스크 간 계약)

```
client/src/components/calculator/
  CalculatorModal.tsx        # T4 — 제프 QuoteRevolutionV2 본체의 모달 어댑터
  TopSelectionCards.tsx      # T3a
  ConditionCards.tsx         # T3b
  QuoteBottomBar.tsx         # T3b
  QuoteResultRow.tsx         # T3b
  lender-meta.ts             # T2 — 제프 sortQuotes LENDER_META 대체(SOLUTION_LENDERS 파생 + 로고)
  types.ts                   # T2 — 제프 redesign/types.ts (ScenarioState·defaultScenario 등) 1:1
  quote-types.ts             # T2 — 제프 types/quote.ts 필요분(QuotePayload·QuoteResult·LeaseTerm·AnnualMileage·AcquisitionTaxMode)
  catalog-types.ts           # T2 — 제프 types/catalog.ts 필요분(TrimOption·TrimOptionRelation·TrimColor)
  calc-format.ts             # T2 — 제프 lib/residual.ts 필요분(formatKrw·roundUpToNearestHundred)
  vehicle/                   # T3a — 픽커 다이얼로그 5종 (제프 components/vehicle 1:1)
  hooks/
    useMasterCatalog.ts      # T2 — CRM /api/vehicles 배선, 반환 계약은 제프 원형 유지
    useTrimExtras.ts         # T2 — 제프 useTrimOptions+useTrimColors 통합(CRM fetchWorkbench 1콜), 반환은 두 훅 원형 분리 유지
    useMultiQuote.ts         # T2 — CRM 릴레이 배선 + SOLUTION_LENDERS
client/public/brand-logos/   # T0 완료(33 PNG 복사됨)
```

## 공통 규칙 (전 태스크)

- UI/UX = 제프 V2 **1:1**(Tailwind 클래스·마크업 유지). 바꾸는 것은 import 경로·데이터 배선뿐(spec 배선표).
- **어휘 SSOT**: 금융사 코드/표시명 = `@/lib/solution-quote` `SOLUTION_LENDERS`. 미취급 판별 = `@/lib/solution-ranking` `isLenderNotAvailableMessage`. 로컬 재정의 금지.
- `any` 금지(unknown+narrow). controlled `<select>`는 `@/lib/select-bind` `bindSelect` 필수(Safari 규칙).
- HTTP는 `@/lib/http`(`getJson`/`sendJson`) — fetch 직접 호출 금지.
- 판매사(BNK 딜러) UI/전송 v1 제외(spec D2): dealerType 토글·딜러 select·bnkDealers prop 체인 제거, affiliateType은 '비제휴사' 고정 유지.
- shadcn import(`@/components/ui/card` 등)는 CRM 기존 파일 사용. CRM에 없는 ui 컴포넌트는 제프 것을 같은 경로로 복사(신규 의존성 추가 금지 — radix 등 미설치면 마크업 인라인 치환).

## 태스크

### T1 — 서버: 릴레이 zod 확장 (독립·병렬)
- `src/routes/solution.ts` `solutionCalcBody`에 spec 목록 17필드 optional 추가(제프 `shared/contracts/quote.schema.ts` 타입 미러 — enum 값까지 대조).
- `client/src/lib/solution-quote.ts` `SolutionQuoteInput` 동반 확장(`_parityCheck` 컴파일 파리티 유지). 기존 워크벤치 빌더(`buildSolutionQuoteInput`) 출력 불변.
- 테스트(TDD): 신규 필드가 zod를 통과해 업스트림 body에 실리는지(zod strip 특성상 확장 없인 탈락 — RED 실관찰) + 기존 필드 계약 회귀.

### T2 — 클라 데이터 계층 (독립·병렬)
- 훅 3종: 반환 타입/필드명은 **제프 원형 유지**(컴포넌트 이식이 기계적이 되도록). 내부만 CRM 배선:
  - useMasterCatalog: `@/lib/vehicles` fetchBrands/fetchModels/fetchTrims. 제프 MasterBrand{brandCode,name}·MasterTrim{mcCode,price,canonicalName…} 모양으로 어댑트(CRM id→brandCode 등 매핑 명시 주석).
  - useTrimExtras: `fetchWorkbench(trimId)` 1콜 → options{basic,tuning,relations,noOptions,loading,loaded}·colors{exterior,interior,loading,loaded} 두 상태로 분해(제프 두 훅의 반환 계약 그대로). mcCode 키 대신 trimId 키 — 트림 변경 시 직전 결과 즉시 클리어(제프 미러).
  - useMultiQuote: lenders = SOLUTION_LENDERS 고정(fetchLenders 제거), calculate = `sendJson("/api/solution/calculate", {lenderCode, ...payload})`, 미취급 = isLenderNotAvailableMessage(HttpError.message — 릴레이가 파트너 400 문구를 {error}로 패스스루).
- types.ts·quote-types.ts·catalog-types.ts·calc-format.ts·lender-meta.ts 이식(사용분만·미사용 필드 제거 가능하되 이름 불변).
- 훅 단위 테스트(가능 범위: useMultiQuote 미취급/실패 분기 — fetch mock).

### T3a — 차량 선택 UI (T2 후)
- vehicle/ 픽커 다이얼로그 5종 + TopSelectionCards 이식. brandLogoUrl은 `/brand-logos/…`(복사 완료) 그대로.
- 데이터는 T2 훅 반환 계약만 소비(제프와 동일 모양이므로 원본 그대로 — import 경로만 교체).

### T3b — 조건/결과 UI (T2 후·T3a와 병렬)
- ConditionCards(판매사 UI 제거 — spec D2 — 그 외 1:1) + QuoteResultRow + QuoteBottomBar + 잔존 미리보기 로직.
- ConditionCards의 bnkDealers prop 체인 제거(타입·호출부 포함).

### T4 — 조립·배선 (T3 후)
- CalculatorModal: 제프 QuoteRevolutionV2 본문 이식(fetchBnkDealers effect 제거) + 전체화면 모달 셸(헤더 X·Esc 닫기·backdrop 닫기 없음) + 로컬 토스트("견적서 보기 준비 중").
- Topbar: calculator-btn onClick → open state, `React.lazy` + Suspense(열릴 때만 로드). dealerMode disabled 불변.

### T5 — 검증 (통합)
- typecheck 0 · lint 0 · unit(전량) · build · knip 신규 0.
- 격리 스택 브라우저 스모크: 모달 오픈 → 브랜드/모델/트림 선택(로고 렌더) → 견적 조회(파트너 prod 실계산) → 결과 행·미취급 숨김 → 조건 복사 → 초기화 → Esc.
- CRM 전역 CSS 충돌 실측 보정(spec D8 리스크).

## 진행 상태
- [x] T0 브랜드 로고 33종 복사
- [x] T1 — 릴레이 zod 17필드 확장(+어휘 상수 4종 SSOT), RED→GREEN, server 552 ⚠️`selectedResidualRateOverride`만 positive(0 거부) — T4에서 percent 0이면 필드 생략
- [x] T2 — 데이터 계층 1,024줄(훅 3종·타입·유틸·lender-meta), unit 694(신규 8). 매핑 표 = useMasterCatalog.ts 상단 주석. lender-meta.ts에 제프 sortQuotes 표면 포함(T3b import 한 경로)
- [x] T3a — 픽커 5종+TopSelectionCards 1,517줄(제프 1:1, DropdownRow dead 제거만·shadcn 의존 0)
- [x] T3b — ConditionCards 742+ResultRow+BottomBar(D2 판매사 제거·약정거리 bindSelect)
- [x] T4 — CalculatorModal(모달 셸·Esc·로컬 토스트·percent 0 잔존 생략 가드)+Topbar lazy 배선+`styles/calculator.css`(스코프 토큰: --accent 파랑 오버라이드·form-input·fade-up·shadow-elev — CRM 전역과 충돌 0)+QuoteBottomBar left-0 보정
- [x] T5 — typecheck 0·lint 0·unit 694·server 552·build·knip main 동일 + **격리 스택 브라우저 스모크 통과**: 모달 lazy 오픈→기아/쏘렌토/트림 픽커(로고·차량 이미지·실데이터 4,058만)→기본가 시드·취득세 자동(2,582,360 산술 정확)→견적 조회 **8사 병렬 실호출 로그 실증**(BNK 200 월 519,700원·금리 6.88%·잔존 58.5%, 미취급 7사 400 조용히 숨김)→행 선택 aria-pressed·"견적서 보기 (1)"→준비 중 토스트→초기화→Esc 닫힘→재열기 fresh(D7). 사용자 dev(5173/8788) 불가침·잔재 0(읽기 전용 스모크)

## 후속 픽스 (유슨생 실기 지적 3건 — 전부 spec D8 리스크 "CRM 전역 CSS 충돌"의 실현이었다)

**🔑 공통 교훈: unlayered 전역 CSS는 Tailwind @layer utilities를 특이성 무관하게 항상 이긴다.** 제프 이식 컴포넌트(Tailwind-only)가 CRM 전역(17k줄, unlayered)과 만나는 지점 3곳이 전부 이 메커니즘.

1. **컨트롤 폰트 거대화+세로 정렬 어긋남**: theme.css `button,input,select{font:inherit}`(unlayered)가 `text-[12px]` 유틸을 덮어 모달 컨트롤 전부 16px 상속(버튼 h 32). → `:where(:not(.calculator-modal *))` 가드. 모달 안은 Tailwind preflight(@layer base)의 동일 규칙이 대신 작동 — 유틸리티 정상 승리. 실측 12px/h24 복원.
2. **줄간격 과대(취득원가 grid)**: dashboard.css 프로토타입 공용 `.grid{display:grid;gap:14px}`가 Tailwind `.grid` 유틸과 **클래스명 충돌** — 모달 모든 grid에 row-gap 14px 주입. → 동일 가드. WebKit(Playwright) 실측 rowGap 14px→normal·그리드 261.9→205.9(제프 실행 실측 ~203 정합). ⚠️첫 검증 때 행 높이만 재고 grid gap을 안 재서 오판 — **"정합" 판정은 gap·마진 등 박스 간 간격까지 재야 한다.** 클래스명 교집합 전수 스캔으로 충돌은 `.grid` 1건뿐 확인.
3. **rem 스케일 6.7% 차이**: 제프 `html{font-size:15px}` vs CRM 16px — Tailwind v4 유틸이 테마 변수를 var() 참조하는 것을 이용해 `.calculator-modal` 스코프에서 `--spacing`·`--text-xs/sm/lg`·`--container-md`를 15/16 배율 오버라이드(px-arbitrary는 원래 동일, line-height 변수는 비율이라 자동 비례). 픽커 폭 448→420(제프 정확 일치).
4. **배경 스크롤 잠금 2겹**: 모달 오픈 시 body overflow hidden(+원복) + 픽커 다이얼로그 열림 시 `:has(.fixed.inset-0.z-50)`로 모달 스크롤러 자체 잠금(다이얼로그 목록 끝 휠 체이닝 차단 — CDP 실휠 600px에 scrollTop 0 유지 실측).
5. 부수: CRM @theme의 Tailwind accent 매핑은 `--accent-shadcn`(--accent 아님) — 픽커 파랑 accent를 위해 동반 오버라이드.
6. **제프 실행 실측 대조 방법론**: 제프 레포를 로컬 vite(5175)로 직접 띄워 같은 요소의 computed 값을 숫자 대조(스크린샷 판독 아님) — 행 41.75 vs 42.48·py 7.5=7.5·버튼 23.5=23.5·input 25.5=25.5.

## 제프 회신 반영 (2026-07-16 — 계약 SSOT = 계산엔진 스펙 개정 3)

- 확장 필드 17종: external 동일 스키마 정상 소비 확인 + 제프 리팩토링 체크리스트 등재 → **종결**.
- 레이트리밋 없음(3×전사 병렬 허용) · `cheapest` 미채택(전사 나열 요건 불일치 + 오설정 실사고 선례).
- BNK 판매사 목록: 제프 선제 구현·**배포 완료**(CRM 실측: 200 `{ok:true,dealers}` 래핑 확정·
  401 게이트 작동·데이터는 수입 브랜드 위주 BMW 3/벤츠 9/아우디 7 — 국산 0, 빈 목록 처리 필수).
  UI 복원 반나절 = 🟡 이사님 수요 판단 대기. ⚠️ 계약 BNK-묶임(라우트명·`bnkDealerName`) —
  CRM 소비는 lender-일반형 seam으로 감싸고, 제프 라우트 일반화 제안은 별도 판단(스펙 개정 3 상세).
- 견적서 PDF: 제프 로드맵 없음 확정 → CRM 자체 구현이 후속 슬라이스 후보(우선순위 미정).
  🟡 이사님 묶음 질의 편입.
