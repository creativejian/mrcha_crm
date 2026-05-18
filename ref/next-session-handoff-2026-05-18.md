# 다음 세션 인계문서 - 2026-05-18 고객관리 리스트

이 문서는 새 세션에서 `영실아 이어가자` 이후 오늘 작업을 바로 이어가기 위한 최신 인계문서다.

## 새 세션 시작 시 먼저 확인할 파일

1. `/Users/jian/.codex/memories/START_HERE_MRCHA.md`
2. `/Users/jian/.codex/memories/MRCHA_CONTINUITY_PROTOCOL.md`
3. `/Users/jian/.codex/memories/mrcha-project-context.md`
4. `/Users/jian/Documents/creativejian/mrcha/crm/ref/current-working-state.md`
5. `/Users/jian/Documents/creativejian/mrcha/crm/ref/business-code-system.md`
6. `/Users/jian/Documents/creativejian/mrcha/crm/ref/pending-tasks.md`
7. 이 파일: `/Users/jian/Documents/creativejian/mrcha/crm/ref/next-session-handoff-2026-05-18.md`

그 다음 CRM repo 상태를 확인한다.

```bash
cd /Users/jian/Documents/creativejian/mrcha/crm
git status --short --branch
git log --oneline --decorate --max-count=5
```

## 현재 작업 요약

- 고객 관리 > 전체 보기 리스트를 실무형 테이블로 다듬는 중이다.
- 기존 디엘오토솔루션 CRM 화면을 참고하되, 차선생 CRM은 더 조용하고 고급스러운 운영툴 UI로 재해석한다.
- 작업 방식은 컬럼 요소 하나씩 논의 -> 영실 피드백 -> 이사님 판단 -> 실제 반영 -> 채택/수정/보류다.
- 전체 컬럼이 어느 정도 확정되면 고객 관리 페이지 전체 레이아웃과 디자인을 다시 잡을 예정이다.

## 오늘 반영된 것

### 체크박스 컬럼

- 체크박스 컬럼 폭을 줄여 테이블 가로 공간을 효율화했다.
- 체크박스 크기는 15px로 확정했다.
- checked 상태는 `#5836ff`를 사용한다.
- header checkbox와 row checkbox 중심 정렬을 맞췄다.
- 체크박스와 관리 버튼은 비슷한 border/shadow 톤으로 맞췄다.

### 고객 컬럼

- 현재 구조는 `이름 + 고객번호 / 고객유형·상세 / 연락처`.
- 이름이 가장 강한 위계다.
- 고객번호는 이름 오른쪽에 작고 연하게 표시한다.
- 고객번호는 현재 목업에서 임시 `C-000128` 형태지만 실제 기준은 `CU-YYMM-####`.
- 직군/상세와 연락처는 비슷한 속성으로 묶고, 연락처는 실무 가독성을 위해 약간 더 선명하게 둔다.
- 긴 이름 정렬 테스트용으로 `홍빛나리`, 영문 이름 `Daniel Kang`이 들어가 있다.

### 페이지네이션

- 고객 리스트는 무한 스크롤보다 페이지네이션으로 가는 것이 적합하다고 판단했다.
- 기본 페이지 크기: `15`.
- 옵션: `15`, `30`, `50`, `100`.
- 현재 20명 목업에서는 15명 기본 노출 + 2페이지 구조다.
- 검색/필터/페이지 크기 변경 시 1페이지로 돌아간다.
- 전체 선택은 현재 페이지에 보이는 고객만 선택한다.

## 현재 수정 중인 파일

- `client/src/pages/CustomerManagementPage.tsx`
- `client/src/index.css`
- `client/src/data/customers.ts`
- `client/src/pages/CustomerManagementPage.test.tsx`
- `ref/business-code-system.md`
- `ref/current-working-state.md`
- `ref/pending-tasks.md`
- `ref/next-session-handoff-2026-05-18.md`

## 오늘 실행한 검증

실행 완료:

```bash
bun run test:unit client/src/pages/CustomerManagementPage.test.tsx
bun run typecheck
```

결과:

- `CustomerManagementPage.test.tsx` 통과
- `typecheck` 통과

## 오늘 아직 안 한 검증 / 후속 작업

### Playwright 시각 검증

오늘 페이지네이션 반영 후 Playwright screenshot/visual 검증은 아직 하지 않았다.

이건 필요 없어서 생략했다기보다, 작업 속도가 느려진 상태에서 우선 unit test와 typecheck까지만 진행한 것이다. 고객관리 리스트는 픽셀/밀도/정렬이 중요한 화면이므로 다음 세션에서 시각 검증을 하는 것이 맞다.

다음 세션 권장 검증:

```bash
bun run screenshot:crm
```

또는 필요한 경우:

```bash
bun run visual:crm
```

확인할 것:

- 100% 브라우저 기준 페이지네이션 하단바 위치/높이/간격
- 1440px, 1280px에서 테이블 가로 스크롤/컬럼 밀도
- 사이드바 펼침/접힘 상태에서 페이지네이션이 어색하지 않은지
- 15/30/50/100 선택 시 dropdown, 페이지 버튼, 범위 텍스트가 깨지지 않는지
- 2페이지 이동 후 row 높이와 하단 여백이 어색하지 않은지
- header checkbox 전체 선택이 현재 페이지 기준으로만 동작하는지

### 전체 검증

아직 실행하지 않은 것:

```bash
bun run lint
bun run build
```

커밋 전에는 실행하는 것이 좋다.

### 커밋/푸시

오늘 최신 고객관리 리스트 변경사항은 아직 커밋/푸시하지 않았다.

다음 세션에서 시각 확인 후 문제가 없으면 커밋 후보:

```text
Refine customer list table and pagination
```

## 미확정 / 보류된 판단

- 페이지네이션 UI의 실제 화면상 밀도와 버튼 톤은 이사님이 아직 시각적으로 최종 판단하지 않았다.
- 고객번호 목업을 실제 체계 `CU-YYMM-####`로 바꿀지는 아직 반영하지 않았다. 현재는 임시 `C-000128` 계열이다.
- 다음 컬럼은 `단계` 컬럼으로 넘어갈 가능성이 높다.
- 고객 관리 전체 레이아웃 재설계는 컬럼 요소를 더 확정한 뒤 진행한다.
- 90% 브라우저 줌/CRM 자체 밀도 전환 버튼은 보류했다. 브라우저 기본 줌으로 충분할 수 있고, CRM 자체 밀도 옵션은 실사용 필요성이 더 명확해질 때 다시 검토한다.

## 다음 세션에서 바로 할 일

1. `git status --short --branch`로 현재 변경 파일 확인.
2. dev server가 떠 있는지 확인. 현재는 보통 `http://127.0.0.1:5174/`.
3. 페이지네이션 UI를 실제 화면에서 먼저 보고, 이사님에게 시각 판단을 받는다.
4. 필요하면 Playwright screenshot을 실행해 페이지네이션/테이블 정렬을 확인한다.
5. 문제가 없으면 다음 컬럼 `단계`로 넘어간다.

## 작업 원칙 재확인

- 이사님이 의견형으로 말하면 바로 구현하지 말고 피드백 후 확인한다.
- 이사님이 `가자`, `해줘`, `적용해`, `진행하자`라고 하면 실행한다.
- UI 변경 시 주변 같은 계열 요소와 크기, 색상, hover/active, border, shadow, baseline을 먼저 비교한다.
- 이사님이 지적하기 전에 일관성 문제를 선제적으로 발견해서 제안한다.
