# 견적 외장/내장 색상 선택 (hex 드롭다운) 설계

작성일: 2026-06-16
상태: 승인됨 (구현 계획 대기)

## 배경 / 목적

견적 workbench의 🎨 옵션/컬러 섹션에서 옵션 선택(OptionPicker)은 됐지만, **외장/내장 색상 버튼은 정적 "미선택"**(`CustomerDetailPage.tsx:5092~5093`)이다. 트림의 `colors`에서 외장/내장 색상을 hex 스와치 드롭다운으로 선택하고, 그 값을 앱카드/견적 출력의 `외장/내장 컬러` 필드에 반영한다.

- 데이터 검증(2026-06-16): `colors` = **트림별 기본 색상 팔레트** (exterior 7,914 / interior 2,569, **전부 hex+code**, 81.7% 한글·18.3% 영문 원본명). **가격 없음**(기본 제공). 유료 매트 도장은 `trim_options`의 외장컬러 옵션으로 별개 처리됨(겹치지 않음).
- `getTrimDetail`이 `colors`를 이미 반환(1단계 `fetchTrimDetail`) → **백엔드·추가 fetch 0**. `trimDetail` state도 2단계에서 보관 중.
- 대상은 김민준 drawer 견적 workbench뿐. (김민준 차종=Maybach/벤츠 → 색상 전부 한글)

## 결정사항 (확정)

- **선택**: 외장 1개 / 내장 1개 **단일선택**(라디오식).
- **연동 범위**: 🎨 섹션 버튼 + **앱카드/견적 출력**의 `외장/내장 컬러: 미선택` 필드.
- **색상명**: 데이터 그대로 표기(예: `폴라 화이트 (149U)`, 코드 포함). 가공 없음.
- **가격 무관**: `colors`엔 price 없음 → 합산 로직 안 건드림.
- **구현**: A안 — `ColorPicker` 컴포넌트(외장/내장 `colorType` prop으로 재사용), VehiclePicker/OptionPicker 패턴.

## 범위

**포함**
- `ColorPicker` 컴포넌트: `colorType`로 필터한 단일선택 hex 스와치 드롭다운 + 컴포넌트 테스트
- `CustomerDetailPage`: 외장/내장 버튼 → `ColorPicker`, `exteriorColor`/`interiorColor` state, 트림 변경 시 초기화, 앱카드/견적 컬러 필드 연동
- `index.css`: hex 스와치·드롭다운 항목 스타일

**비범위 (다음 단계)**
- 구매방식별 할인 매핑(financial/partner/cash), 취득세 공식 자동계산
- 가격 패널·옵션·컬러 통합 컴포넌트 추출
- 견적 저장(quotes 스키마)
- 색상 "미선택"으로 되돌리기(트림 변경 시에만 초기화; 단일선택은 다른 색으로만 변경)

## 아키텍처 (A안)

`ColorPicker`는 **controlled** 컴포넌트 — 선택값(`value`)은 부모 state가 진실이고 내부엔 드롭다운 open 상태만 둔다(OptionPicker의 내부 selectedIds와 달리 `key` 재마운트 불필요). 색상은 순수 계산 로직이 사실상 없어(=colorType 필터뿐) 별도 lib 없이 컴포넌트로 충분(YAGNI). 표시 연동은 부모 state를 앱카드 JSX가 참조하는 단방향.

## ① 데이터 — `trimDetail.colors` (이미 보관)

`TrimColor`(`client/src/lib/vehicles.ts`): `{ id, colorType: "exterior"|"interior", name, code, hexValue, sortOrder }`. 1단계 `fetchTrimDetail`이 반환, 2단계에서 `trimDetail` state로 보관 중.

## ② `ColorPicker` — `client/src/components/ColorPicker.tsx` (신규)

```tsx
type ColorPickerProps = {
  colorType: "exterior" | "interior";
  colors: TrimColor[];
  value: TrimColor | null;
  onChange?: (color: TrimColor) => void;
};
```

- 내부에서 `colors.filter((c) => c.colorType === colorType)`, `sortOrder` 정렬.
- 버튼(`kim-jeff-picker-row`): 라벨 `colorType === "exterior" ? "외장" : "내장"`, 값은 `value ? [스와치 + value.name] : "미선택"(muted)`.
- 클릭 시 드롭다운(바깥 클릭/Esc 닫힘, VehiclePicker 패턴). 각 항목 `[hex 스와치] {name}`, 클릭 → `onChange(color)` + 닫힘. 현재 `value`는 `is-selected` 표시.
- 해당 타입 색상이 없으면(또는 trim 미선택) 버튼 `disabled`.

## ③ 상태 — `CustomerDetailPage`

```ts
const [exteriorColor, setExteriorColor] = useState<TrimColor | null>(null);
const [interiorColor, setInteriorColor] = useState<TrimColor | null>(null);
```

`applyTrimToPricing`에서 트림 변경 시 `setExteriorColor(null)` / `setInteriorColor(null)`로 초기화(가격 input 0 리셋과 같은 자리).

## ④ 연동

- 외장/내장 버튼(`5092`/`5093`)을 교체:
  ```tsx
  <ColorPicker colorType="exterior" colors={trimDetail?.colors ?? []} value={exteriorColor} onChange={setExteriorColor} />
  <ColorPicker colorType="interior" colors={trimDetail?.colors ?? []} value={interiorColor} onChange={setInteriorColor} />
  ```
- 앱카드/견적 출력의 `외장/내장 컬러` 필드(`5349~5350`, `5441~5442`)를 state 참조로:
  ```tsx
  <dt>외장 컬러</dt><dd>{exteriorColor?.name ?? "미선택"}</dd>
  <dt>내장 컬러</dt><dd>{interiorColor?.name ?? "미선택"}</dd>
  ```
- 색상 변경 시 `markQuoteDraftChanged()`로 draft dirty 표시(onChange 핸들러에서).

## ⑤ 테스트 — vitest

- `ColorPicker.test.tsx`: `colorType="exterior"` 렌더 → 드롭다운에 외장 색상만(내장 제외), 색상 클릭 시 `onChange(color)` 호출, `value` 주입 시 버튼에 색상명 표시. props 주입(fetch mock 불필요).
- `CustomerDetailPage` 통합은 1·2단계와 동일하게 수동 확인(거대 컴포넌트 비범위).

## 영향 파일

- 신규: `client/src/components/ColorPicker.tsx`(+test)
- 수정: `client/src/pages/CustomerDetailPage.tsx`(버튼 교체·state·앱카드 연동), `client/src/index.css`(스와치/드롭다운 스타일)

## 검증

- `bun run typecheck`, `bun run lint` 0 problems
- `bun run test:unit`(ColorPicker)
- 워크벤치 스크린샷 1회(외장/내장 스와치 드롭다운 + 선택 → 앱카드 반영)

## 다음 단계 (이 spec 이후)

1. 구매방식별 할인 매핑(financial/partner/cash) + 취득세 공식 자동계산 (이사님 할인 다중행·취득세 4탭 UI 위에 계산 연결)
2. 가격 패널·옵션·컬러 통합 컴포넌트 추출
3. 견적 저장(quotes 스키마, `catalog.trims`/옵션/색상 스냅샷)
