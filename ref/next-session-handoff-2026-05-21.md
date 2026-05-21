# 다음 세션 인계문서 - 2026-05-21 고객관리 컬럼 1차 완성

이 문서는 새 세션에서 이사님이 `영실아 이어가자`라고 했을 때 고객 관리 전체 보기 작업을 바로 이어가기 위한 인계문서다.

## 새 세션 첫 응답 전 필수 복구

새 세션에서는 현재 대화 요약만 믿지 말고 아래 순서로 먼저 읽는다.

1. `/Users/jian/.codex/memories/START_HERE_MRCHA.md`
2. `/Users/jian/.codex/memories/mrcha-project-context.md`
3. `/Users/jian/Documents/creativejian/mrcha/docs/codex-continuity-brief.md`
4. `/Users/jian/Documents/creativejian/mrcha/docs/mrcha-context-digest.md`
5. `/Users/jian/Documents/creativejian/mrcha/crm/ref/tech-stack.md`
6. `/Users/jian/Documents/creativejian/mrcha/docs/next-session-handoff-for-codex.md`
7. `/Users/jian/Documents/creativejian/mrcha/crm/ref/current-working-state.md`
8. 이 파일: `/Users/jian/Documents/creativejian/mrcha/crm/ref/next-session-handoff-2026-05-21.md`

그 다음 CRM repo 상태를 확인한다.

```bash
cd /Users/jian/Documents/creativejian/mrcha/crm
git status --short --branch
git log --oneline --decorate --max-count=5
```

## 현재 Git 상태

고객 관리 컬럼 1차 완성 작업은 커밋/푸시 완료됐다.

```text
5fc9d18 (HEAD -> main, origin/main) feat: finalize customer list column layout
```

마지막 확인 기준 워크트리는 깨끗했다.

```text
## main...origin/main
```

## 이번 세션의 최종 결론

고객 관리 > 전체 보기의 `컬럼 내부`는 1차 완성으로 닫는다.

다음 세션에서는 컬럼 내부 폰트/간격/버튼/정렬을 다시 파고들지 말고, 이사님이 명확히 문제를 발견한 경우에만 최소 단위로 확인한다. 기본 방향은 다음 단계인 전체 화면 레이아웃이다.

## 현재 컬럼 순서

최고관리자/팀장 기준 전체 보기:

```text
선택 / 고객 / 차종 · 구매방식 / 진행 상태 / 계약 가능성 / 상담 메모 · 문의 사항 / 접수 · 배정 / 관리 상태 / 액션
```

`접수 · 배정`은 `유입 경로 + 담당`을 통합한 컬럼이다. `접수 · 배정`을 액션 오른쪽 끝으로 보내는 안은 검토했으나 비추천으로 정리했다. 이유는 접수/배정이 액션 도구가 아니라 고객 운영 맥락이기 때문이다. 현재 위치는 `상담 메모 이후 운영 맥락`으로 읽히는 것이 맞다.

## 접수 · 배정 컬럼 최신 구조

구조:

```text
접수 / 앱 견적비교 · 오늘 12:56
배정 / 김지안 · 오늘 13:04
응답 / 배정 후 38분
```

결정:

- `자동/수동` 표시는 상담사 스캔에서 중요도가 낮아 제거했다.
- 접수 경로 자체가 핵심이다.
- 담당자 별칭은 실명으로 바꿨다.
  - `지안` -> `김지안`
  - `선생님` -> `이주선`
  - `제프` -> `이건수`
- 컬럼명은 `접수 · 배정`이다.
- `담당` 라벨은 `배정`으로 바꿨다.
- 변경 버튼은 최고관리자/팀장만 노출한다.
  - 최고관리자: 접수 경로와 담당자 변경 가능
  - 팀장: 담당자만 변경 가능
- 현재 목업 버튼은 담당자 순환 변경만 수행한다.

날짜 표기:

- 오늘/어제는 유지한다.
  - `오늘 12:56`
  - `어제 18:42`
- 그 외는 숫자형으로 표시한다.
  - `26/05/08 13:20`
- 이유: `5월 8일`의 `월/일` 한글이 3줄 운영 메타 안에서 집중도를 떨어뜨렸다.

주의:

- `오늘/어제` 기준은 아직 목업 하드코딩이다.
- 실제 DB/API 연결 시 공통 날짜 formatter로 교체해야 한다.
- `응답` 지표는 아직 진짜 최초 응답 시간이 아니다. 현재는 관리 상태 업데이트 시간을 임시로 첫 액션처럼 해석한다.

## 컬럼 폭 최종값

본문 컨텐츠와 버튼 구조는 건드리지 않고 col width만 정리했다.

1440px 기준:

```text
선택 55
고객 139.67
차종 · 구매방식 140
진행 상태 170
계약 가능성 76
상담 메모 141.81
접수 · 배정 230
관리 상태 83.52
액션 124
```

2048px 기준:

```text
고객 198.64
차종 · 구매방식 190.45
진행 상태 204.8
계약 가능성 96
상담 메모 531.27
접수 · 배정 249.84
관리 상태 118
액션 124
```

주요 gap:

- 상담 메모 pencil -> 접수·배정 시작: `46px`
- 교체 버튼 -> 관리 상태 버튼:
  - 1440px: `35.75px`
  - 2048px: `53px`
- 관리 상태 버튼 -> 액션 묶음:
  - 1440px: `21.77px`
  - 2048px: `39px`
- 마지막 액션 버튼 오른쪽: `20px` 유지

## 3줄 컬럼 수직 정렬 기준

이사님 기준:

- `고객 / 차종 · 구매방식 / 접수 · 배정` 세 컬럼은 모두 3줄 그리드로 본다.
- 각 컬럼의 1줄 center가 맞아야 한다.
- 각 컬럼의 2줄 center가 맞아야 한다.
- 각 컬럼의 3줄 center가 맞아야 한다.
- 1줄 위 여백과 3줄 아래 여백도 가능한 한 동일해야 한다.

최종 보정:

```css
.vehicle-method {
  min-height: 18px;
  transform: translateY(0.8125px);
}

.vehicle-trim {
  transform: translateY(1.125px);
}

.operation-line:nth-child(2) {
  transform: translateY(0.805px);
}
```

검증 결과:

- 1~12행 기준 1줄 center spread: 모두 `0px`
- 배지 없는 행의 2줄/3줄 spread: `0px / 0.01px`
- 배지 있는 김민준 행: `0.56px / 0.56px` 이내
- 문태호 행 기준:
  - `문태호` / `팰리세이드`: center 차이 `0px`
  - `개인 · 4대보험` / `2.5T 하이브리드 · 9인승`: center 차이 `0px`
  - `010-7130-2298` / `장기렌트` 텍스트: center 차이 `0px`
- `+1` 배지 포함 줄 전체 박스는 배지 높이 때문에 아래 여백이 다르게 보일 수 있으나, 텍스트 자체는 맞다.

## 중앙 버튼 세로 정렬 검증

다음 버튼군은 1~12행 기준 모두 row center와 center delta `0px`으로 확인했다.

- 진행 상태 1차 버튼
- 진행 상태 2차 버튼
- 계약 가능성 버튼
- 상담 메모 pencil 버튼
- 접수·배정 교체 버튼
- 관리 상태 버튼
- 액션 3개 버튼

예시 1행:

- 진행/계약/관리 상태 24px 버튼: 위 `26.47px`, 아래 `26.47px`
- 상담 메모/교체 18px 버튼: 위 `29.47px`, 아래 `29.47px`
- 액션 28px 버튼: 위 `24.47px`, 아래 `24.47px`

## 버튼/배지 스타일 결정

- 액션 버튼 간격은 `7px`로 유지한다.
- 액션 컬럼 오른쪽 마지막 버튼 기준 `20px`은 고정이다.
- AI 힌트 버튼도 hover/focus/active/open 상태에서 일반 액션 버튼과 같은 보라 border/ring을 사용한다.
- 차종·구매방식의 `+N` 배지는 기능은 그대로 두고 neutral soft elevation으로 조정했다.
- `+N` 배지는 보라 status badge가 아니라 보조 정보 배지이므로 기본은 회색/neutral, hover/focus/active에서만 보라 tint/ring을 쓴다.
- `높음` 같은 계약 가능성 배지 스타일을 `+N`에 적용하지 않는다.

## 사이드메뉴 상태

- 사이드메뉴 2차 스타일은 이전에 잠정 완료/동결했다.
- 이번 세션에서 큰 메뉴 텍스트가 너무 얇아져 보이는 문제만 보정했다.
- `nav button` 기본 font-weight를 `350`에서 `500`으로 조정했다.
- 서브메뉴/active/아이콘/간격 값은 유지했다.
- 당분간 사이드메뉴 전체 스타일은 건드리지 않는다.

## 마지막 검증

이번 컬럼 1차 완성 전후로 실행한 주요 검증:

```bash
bun run typecheck
bun run screenshot:crm
```

둘 다 통과했다.

최신 캡처:

```text
screenshots/customer-management-1440.png
screenshots/customer-management-1280.png
screenshots/customer-management-1280-right.png
```

추가로 Playwright headless 측정으로 다음을 확인했다.

- 1440/2048 컬럼 폭 및 주요 gap
- 1~12행의 3줄 center spread
- 문태호 행의 텍스트 자체 top/bottom/center
- 1~12행 중앙 버튼군의 row center delta

## 다음 세션에서 바로 할 일

다음 단계는 `칼럼 내부`가 아니라 `전체 화면 레이아웃`이다.

우선순위:

1. 전체 화면 상단 영역과 리스트의 관계
2. 필터/검색/탭/페이지네이션 밀도
3. 카드/테이블 외곽 여백
4. 화면 전체에서 사이드바, 헤더, 리스트가 차지하는 비율
5. 실제 권한별 화면에서 `접수 · 배정` 노출 방식

작업 시작 전 이사님에게 이렇게 확인하면 된다.

```text
이사님, 컬럼 내부는 1차 완성으로 닫고 전체 화면 레이아웃으로 넘어가겠습니다. 먼저 상단 헤더/필터/리스트 외곽 여백부터 보겠습니다.
```

## 주의할 대화 방식

이사님이 의견형으로 말하면 바로 구현하지 말고 먼저 판단을 말한다.

예:

- `~같은데`
- `~어때`
- `괜찮을까`
- `너 생각은?`

이 경우:

```text
제 판단은 ... 입니다. 이유는 ... 입니다. 적용할까요?
```

이사님이 실행형으로 말하면 바로 작업한다.

예:

- `진행하자`
- `해줘`
- `적용해`
- `바꾸자`
- `구현해`

## 다음 세션에서 건드리지 말 것

이사님이 새로 문제를 발견하지 않는 한 아래는 다시 만지지 않는다.

- 고객/차종/접수·배정 3줄 내부 line-height/transform
- 액션 버튼 gap `7px`
- 마지막 액션 버튼 오른쪽 `20px`
- 접수·배정 날짜 표기 방식
- `+N` 배지 기본 neutral 스타일
- 사이드메뉴 2차 스타일

전체 레이아웃을 보면서 정말 어긋난 것이 발견되면, 해당 부분만 측정 후 최소 수정한다.
