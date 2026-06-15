# 옵션 excludes 비활성화 UX (미스터차 앱 정합) 설계

작성일: 2026-06-15
상태: 승인됨 (구현 계획 대기)

## 배경 / 목적

2단계(PR #14)에서 옵션 선택·합산·관계 강제를 붙였다. 단 excludes를 **"자동 해제"**(A 켜면 배타 상대 체크 풀림)로 구현했는데, 미스터차 앱은 **"비활성화"** 방식이다(A 켜면 배타 상대가 회색 + 클릭 불가). 앱 UX에 맞춘다.

- 데이터: 관계는 `excludes` 5,862개 / `includes` 374개. 외장컬러·패키지군 등 "중복 선택 불가"는 전부 excludes.
- 앱 레퍼런스: 배타그룹을 **색 점**으로(같은 색 = 중복 불가), 선택 시 같은 그룹 나머지 **비활성화**, 각 옵션에 **"⇄ ○○와 중복 선택 불가"** 설명, 상단 안내.
- PR #14에 이어서 같은 브랜치(`feat/quote-option-selection`)에서 진행. 대상은 김민준 drawer 견적 workbench 옵션 드롭다운(OptionPicker)뿐.

## 결정사항 (확정)

- **excludes**: "자동 해제"를 제거하고 **비활성화(disabled)**로 대체. 선택된 옵션과 배타관계인 옵션은 회색 + 클릭 불가.
- **색**: 배타그룹(excludes connected component)마다 색 점. 6색 팔레트(빨/파/초/주황/보라/청록)를 `그룹번호 % 6`으로 순환.
- **설명 텍스트**: 배타관계가 있는 옵션마다 "⇄ {상대 이름들}와 중복 선택 불가" 항상 표시.
- **상단 안내**: excludes 그룹이 있을 때 "● 같은 색 = 중복 선택 불가".
- **includes**(374개, 소수·화면 미노출): 현 자동추가(한 단계) 유지.

## 범위

**포함**
- `option-selection.ts` 확장: `resolveSelection`에서 excludes 자동해제 제거 + 신규 `disabledOptionIds`/`excludeGroups`/`excludePartners` (TDD)
- `OptionPicker` 확장: 색 점, 비활성화, 설명 텍스트, 상단 안내
- `index.css`: 색 점/disabled/설명/안내 스타일

**비범위 (다음 단계)**
- 외장/내장 컬러 선택, 할인 매핑, 취득세 공식 (이후 단계)
- includes 다단계·시각화
- excludes가 **이미 둘 다 선택된** 모순 데이터의 사후 정리 — 비활성화로 그런 상태가 새로 생기지 않으므로 별도 처리 안 함

## 아키텍처 (A안)

관계 강제 로직은 순수 함수로 유지·확장(TDD), OptionPicker는 그 결과를 렌더. excludes 충돌 방지를 "선택 시 자동 변경"이 아니라 "선택 불가(disabled)"로 옮기므로, `resolveSelection`은 단순해지고(includes만 처리) 비활성화 계산은 별도 순수 함수가 담당한다.

## ① 순수 로직 — `client/src/lib/option-selection.ts` 확장 (TDD)

```ts
// 변경: excludes 자동해제 제거. on이면 toggledId 추가 + includes(단방향 한 단계) 추가, off면 제거.
export function resolveSelection(relations, selected, toggledId, on): Set<number>;

// 선택된 옵션과 excludes 관계인(아직 선택 안 된) 옵션 = 비활성화 대상. 대칭.
export function disabledOptionIds(relations: OptionRelation[], selectedIds: ReadonlySet<number>): Set<number>;

// excludes를 무방향 그래프로 보고 connected component로 묶어 optionId→그룹번호.
// 그룹번호는 options 순서 기준으로 0,1,2… 안정 부여. excludes 미참여 옵션은 맵에 없음.
export function excludeGroups(options: OptionLite[], relations: OptionRelation[]): Map<number, number>;

// optionId와 excludes 관계인 상대 id들(대칭, 중복 제거).
export function excludePartners(relations: OptionRelation[], optionId: number): number[];
```

- `disabledOptionIds`: 각 excludes 관계에서 한쪽이 선택됐고 다른 쪽이 미선택이면 그 다른 쪽을 disabled에 추가.
- `excludeGroups`: union-find 또는 BFS. `options` 순회 순서로 그룹 인덱스를 안정 할당해 색이 흔들리지 않게 한다.

## ② `OptionPicker` 확장

- 파생: `const disabled = disabledOptionIds(relations, selectedIds)`, `const groups = excludeGroups(options, relations)`, 옵션별 `excludePartners`.
- 각 옵션 row:
  - 앞에 **색 점**: `groups.get(o.id)`가 있으면 `그룹번호 % 6` 색 클래스. 없으면 점 없음.
  - 체크박스(`role="checkbox"`) + 이름 + `+{price}원`.
  - `disabled.has(o.id)`이면 `disabled` 속성 + 회색 클래스. 클릭(toggle) 무시.
  - 배타관계 있으면(`excludePartners(relations, o.id).length`) 아래 작은 텍스트 "⇄ {상대 이름들 join(', ')}와 중복 선택 불가". 상대 이름은 `options`에서 id→name.
- 패널 상단: `groups.size > 0`이면 안내 행 "● 같은 색 = 중복 선택 불가"(색 점 몇 개 + 문구).
- `toggle`은 그대로 `resolveSelection` 사용(이제 excludes 자동해제 없음).

## ③ 색 팔레트

6색 — 빨강 `#e5484d`, 파랑 `#3b82f6`, 초록 `#22a06b`, 주황 `#f5a524`, 보라 `#8b5cf6`, 청록 `#06b6d4`. CSS 클래스 `.kim-option-picker-dot--0` ~ `--5`. 그룹번호 `% 6`.

## ④ CSS — `client/src/index.css`

- `.kim-option-picker-dot`(원형 점) + 색별 변형, `.kim-option-picker-option:disabled`(회색/opacity/커서), `.kim-option-picker-relation`(작은 회색 설명), `.kim-option-picker-hint`(상단 안내).

## ⑤ 테스트 — vitest

- `option-selection.test.ts`: `resolveSelection` — excludes 자동해제 **없어짐**(켜도 배타상대 그대로) 검증으로 수정, includes 자동추가 유지. `disabledOptionIds` — 선택 시 배타상대 disabled(대칭), 둘 다 미선택이면 빈. `excludeGroups` — 같은 배타군 같은 그룹번호, 무관 옵션은 맵에 없음. `excludePartners` — 대칭 상대 목록.
- `OptionPicker.test.tsx`: excludes 옵션 선택 시 상대가 `disabled`로 바뀌고 클릭 무시, 색 점 렌더, 설명 텍스트 표시. 기존 "excludes 자동해제" 테스트는 "비활성화"로 교체.

## 영향 파일

- 수정: `client/src/lib/option-selection.ts`(+test), `client/src/components/OptionPicker.tsx`(+test), `client/src/index.css`

## 검증

- `bun run typecheck`, `bun run lint` 0 problems
- `bun run test:unit`
- 워크벤치 스크린샷 1회(배타그룹 색 점 + 선택 시 비활성화)

## 다음 단계 (이 spec 이후)

1. 외장/내장 컬러 선택(hex 스와치)
2. 구매방식별 할인 매핑 + 취득세 공식
3. 가격 패널·옵션·컬러 통합 컴포넌트 추출
4. 견적 저장(quotes 스키마)
