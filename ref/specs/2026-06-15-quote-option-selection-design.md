# 견적 옵션 선택 → 옵션 금액 합산 (2단계) 설계

작성일: 2026-06-15
상태: 승인됨 (구현 계획 대기)

## 배경 / 목적

1단계에서 트림 선택 → 가격 패널 합산을 연결했다(PR #13). 단 **옵션 금액은 `0` 고정**이었다(옵션 선택 UI가 없어서). 2단계는 그 빈 조각을 채운다: 트림의 **tuning 옵션을 선택**하면 그 금액이 가격 합산의 `(+) 옵션 금액`에 반영된다.

- 데이터는 충분: `trim_options` 10,495행, `trim_option_relations` 6,236행. `getTrimDetail`이 `options`/`optionRelations`를 이미 반환(1단계 `fetchTrimDetail`) → **백엔드 추가 작업 0**.
- 현재 🎨 옵션/컬러 섹션은 정적 버튼 3개(옵션/외장/내장, 전부 "미선택"). 이번엔 **옵션 버튼만** 동작시킨다. 외장/내장 컬러는 3단계.
- 대상은 김민준 drawer(`CU-2605-0020`) 견적 workbench(Jeff body)뿐. 다른 화면 불변.

## 결정사항 (확정)

- **범위**: 옵션 선택 + 옵션 금액 합산. 컬러/할인 매핑/취득세 공식은 다음 단계.
- **basic/tuning 옵션**: 둘 다 **선택·합산**. 그룹만 "기본 옵션"/"튜닝 옵션"으로 분리 표시. (구현 중 데이터 검증으로 정정: basic도 유료 제조사 옵션 — `trim_options` 6,737개 중 99.6%가 유료, 예 파노라마 선루프 107만. 당초 "basic 표시만/합산 제외" 가정은 오류였음.)
- **관계 강제** (includes/excludes):
  - **excludes**: 옵션 A를 켤 때, A와 배타관계인 옵션이 켜져 있으면 자동 해제. **대칭** 처리(데이터가 단방향이어도 양방향 적용).
  - **includes**: 옵션 A를 켤 때, A가 포함하는 옵션도 자동 ON. **단방향, 한 단계만**. 끌 때는 연쇄 해제 안 함(예측 가능·단순).
- **구현**: A안 — `OptionPicker` 독립 컴포넌트 + 관계 강제 순수 lib(`option-selection.ts`). VehiclePicker 패턴과 일관.

## 범위

**포함**
- 순수 로직 lib `client/src/lib/option-selection.ts` (`resolveSelection`, `optionTotal`) + 단위테스트(TDD)
- `OptionPicker` 컴포넌트: `options`/`optionRelations` props → 다중선택 드롭다운(basic/tuning 모두 체크, 그룹만 분리), `onChange({ selectedIds, total })`
- `CustomerDetailPage`: 트림 선택 시 `TrimDetail`을 state로 보관 → `OptionPicker`에 전달 → 옵션 `total`을 `data-pricing="option"` input에 반영 → 1단계 `recompute`로 합산
- 트림 변경 시 옵션 선택 초기화

**비범위 (다음 단계)**
- 외장/내장 컬러 선택 (3단계)
- 구매방식별 할인 매핑(financial/partner/cash), 취득세 공식 자동계산 (3단계)
- includes 다단계 closure / 끌 때 연쇄 해제 / includes로 추가된 옵션의 2차 관계 적용 — 한 단계만 적용(YAGNI)
- 가격 패널·옵션 컴포넌트 통합 추출, quotes 저장 (4단계)

## 아키텍처 (A안)

옵션 선택은 다중선택 + 관계 연쇄라 1단계의 uncontrolled 패턴과 달리 **React state가 자연스럽다**. 단 가격 합산과의 접점은 1단계 패턴을 그대로 재사용한다: 옵션 `total`만 `data-pricing="option"` input에 명령형으로 흘려보내고, 합산은 기존 `recompute`가 처리. 관계 강제 로직은 순수 함수로 분리해 TDD로 검증.

## ① 데이터 — `CustomerDetailPage`가 `TrimDetail` 보관

1단계 `applyTrimToPricing`은 `fetchTrimDetail` 결과에서 가격만 뽑고 버렸다. 2단계는 옵션/색상에 필요하므로 state로 보관한다.

```ts
const [trimDetail, setTrimDetail] = useState<TrimDetail | null>(null);
// applyTrimToPricing 안에서 detail 수신 후: setTrimDetail(detail)
```

## ② 순수 로직 — `client/src/lib/option-selection.ts` (신규, TDD)

```ts
export type OptionRelation = { optionId: number; relatedOptionId: number; type: "includes" | "excludes" };
export type OptionLite = { id: number; type: "basic" | "tuning"; price: number | null };

// toggledId를 on(true)/off(false)로 바꿨을 때 관계를 적용한 새 선택 집합을 반환.
export function resolveSelection(
  relations: OptionRelation[],
  selected: ReadonlySet<number>,
  toggledId: number,
  on: boolean,
): Set<number>;

// 선택된 옵션의 price 합(basic/tuning 모두, price null → 0).
export function optionTotal(options: OptionLite[], selectedIds: ReadonlySet<number>): number;
```

`resolveSelection` 규칙:
- **on = true**: ① `toggledId` 추가 → ② `toggledId`와 excludes 관계인 옵션 모두 제거(대칭: 관계의 `optionId`/`relatedOptionId` 중 한쪽이 `toggledId`이면 반대쪽 제거) → ③ `toggledId`가 includes하는 옵션(`optionId === toggledId && type === "includes"`의 `relatedOptionId`) 추가(한 단계).
- **on = false**: `toggledId`만 제거. 연쇄 없음.
- 입력 `selected`는 변경하지 않고 새 `Set` 반환(순수).

`optionTotal`: `selectedIds`에 속하고 `type === "tuning"`인 옵션의 `price ?? 0` 합.

## ③ `OptionPicker` — `client/src/components/OptionPicker.tsx` (신규)

- props: `{ options: TrimOption[]; relations: TrimOptionRelation[]; onChange?: (next: { selectedIds: number[]; total: number }) => void }`.
- 내부 state: `selectedIds: Set<number>`(초기 빈 집합). `options` 레퍼런스가 바뀌면(트림 변경) 초기화.
- 버튼 행(기존 `kim-jeff-picker-row` 스타일): 요약 표시 `기본 N · 추가 M · +{금액}원`. 클릭 시 패널 토글, 바깥 클릭/Esc로 닫힘(VehiclePicker와 동일 패턴).
- 패널: basic/tuning 모두 체크 토글(`name` + `+{price}원`), 그룹 라벨만 "기본 옵션"/"튜닝 옵션"으로 분리. 토글 → `resolveSelection(relations, selectedIds, id, on)` → `setSelectedIds` → `onChange({ selectedIds: [...next], total: optionTotal(options, next) })`.
- excludes로 자동 해제되거나 includes로 자동 추가된 항목은 체크 상태로 즉시 반영(파생 렌더).

## ④ 연결 — `CustomerDetailPage`

- 🎨 옵션/컬러 섹션의 정적 "옵션" 버튼(현재 약 `4884`)을 `<OptionPicker ... />`로 교체. 외장/내장 버튼(`4885~4886`)은 그대로(3단계).
- `trimDetail`이 없으면(차량 미선택) OptionPicker는 비활성/안내 표시.
- `OptionPicker onChange` → `data-pricing="option"` input에 `formatMoney(total)` 명령형 set → `recompute()` + `markQuoteDraftChanged()`.
- 트림 변경 시: `setTrimDetail(detail)`로 options/relations 교체 → OptionPicker가 선택 초기화 → option input은 `applyTrimToPricing`에서 `0`으로 리셋(1단계 동작 유지)되고 합산 재계산.

## ⑤ 테스트 — vitest

- `option-selection.test.ts`(신규, TDD): `resolveSelection` — 단순 토글, excludes 자동 해제(대칭), includes 자동 추가(한 단계), 끄기 시 연쇄 없음, 원본 Set 불변. `optionTotal` — basic/tuning 모두 합산, `price null → 0`.
- `OptionPicker.test.tsx`(신규): 렌더 → 옵션 체크 시 `onChange` total, basic도 체크 가능, excludes 토글 시 상대 해제. fetch mock 불필요(props 주입).
- `CustomerDetailPage` 통합은 1단계와 동일하게 수동 확인(거대 컴포넌트 풀 테스트 비범위).

## 영향 파일

- 신규: `client/src/lib/option-selection.ts`(+test), `client/src/components/OptionPicker.tsx`(+test)
- 수정: `client/src/pages/CustomerDetailPage.tsx`(trimDetail state + OptionPicker 연결), `client/src/index.css`(옵션 드롭다운/체크리스트 스타일)

## 검증

- `bun run typecheck`, `bun run lint` 0 problems
- `bun run test:unit`(option-selection / OptionPicker)
- 필요 시 워크벤치 스크린샷 1회(옵션 선택 → 옵션 금액/합산 변동)

## 다음 단계 (이 spec 이후)

1. 외장/내장 컬러 선택(hex 스와치, 하단 세부견적 컬러 필드 연동)
2. 구매방식별 할인 매핑(financial/partner/cash) + 취득세 공식 자동계산 + segment 토글 재분류
3. 가격 패널·옵션·컬러 통합 컴포넌트 추출
4. 견적 저장 시 `trimId`/선택 옵션/가격 스냅샷 저장 (CRM quotes 스키마와 연계)
