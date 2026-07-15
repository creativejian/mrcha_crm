# 고객 관리 5개 mode 콘솔 레이아웃 통일 — 설계

Last updated: 2026-07-15 (세션 0715-rest-refactoring · 유슨생 · brainstorming 승인)

## 배경 / 문제

`CustomerManagementPage`는 6개 mode를 렌더한다: `all`(전체 보기)·`consulting`(상담 필요)·`contract`(계약 관리)·`delivery`(출고 관리)·`settlement`(출고 정산)·`hold`(보류/이탈).

`all`만 콘솔 문법(1줄 컨트롤 rail + 흰 헤더·연회색 바디 테이블 서피스)이고, **나머지 5개는 구식 2줄 rail + 회색 전역 헤더**다. `#226`(콘솔 톤 전 페이지 확산)이 헤더 타이틀 톤만 통일했고, 컨트롤 rail과 테이블 서피스는 `mode="all"`에만 적용돼 남아 있었다.

두 갈래가 `isConsole = mode === "all"` 하나로 갈린다(`CustomerManagementPage.tsx:816`) — section·card·control-rail·toolbar·headbar·search·filter·table·pagination 클래스 전부. 즉 **컨트롤 rail JSX가 두 벌**(콘솔용/구식용) 존재한다.

### 실버그 (통일로 자동 해소)
비콘솔 mode에서 **담당자 변경 팝오버가 깨져 인라인 텍스트로 흐른다**. 원인: `.advisor-change-confirm`/`.advisor-change-wrap`의 모든 규칙이 `.customer-console-headbar` 하위로만 스코프됨(`customer-console.css:793~969`). 비콘솔은 `.list-headbar`(console-headbar 없음)라 팝오버 스타일 0 → position:absolute 없이 블록으로 흐름. `#216`(일괄 담당자 변경)이 콘솔 전제로만 짜인 것. 콘솔 headbar 클래스가 붙으면 자동 해결.

## 확정 결정 (유슨생)

1. **5개 mode 전부** 통일(사이드바 상담 필요·계약 관리·출고 관리·출고 정산·보류/이탈). delivery/settlement는 데이터가 프로토타입이지만 껍데기는 같이 통일.
2. **필터/select 항목은 각 mode 그대로 유지 — 시각(껍데기)만 통일.** 전체 보기의 계약가능성/관리상태 필터를 다른 mode에 억지로 넣지 않음.
3. **죽은 mock select 3개**(담당자별 보기·상담상태별 보기·긴급순으로 보기, `:971-973` 옵션 1개·onChange 없음) **유지.** 지금은 아무 동작 안 하지만 나중에 기능 붙일 자리. 시각만 콘솔 pill로.
4. **rail 배치 = 완전 1줄**(전체 보기와 동일 문법). 목업 A 채택 — B(2줄 유지·톤만) 기각.
5. **카운트 표기 통일** — `TOTAL N`(구식) → `전체 N명`(콘솔).
6. **클래스 이름 유지** — `customer-console-*` 그대로 전 mode 공용. 중립 리네임 기각(CSS 대량 변경 + 계산값 대조 비용이 실익 초과, YAGNI).

## 설계

### 핵심 접근: `isConsole`을 "레이아웃 게이트" → "필터 세트 선택자"로 의미 축소

레이아웃 클래스는 전 mode 무조건 콘솔로 만들고, mode 차이는 **딱 한 곳 — 필터 항목** — 에만 남긴다. `isConsole` 변수는 완전히 제거하지 않되(all 전용 필터 세트 조건에 필요), 이름을 의미에 맞게 `isAllMode` 등으로 좁힌다(레이아웃 분기가 아니라 필터 세트 분기임을 코드에서 드러냄).

### 구체 변화 (`CustomerManagementPage.tsx:884~1210`)

| 항목 | 지금 | 통일 후 |
|---|---|---|
| section/card/rail/toolbar/headbar/pagination 클래스 | `isConsole ? 콘솔 : 구식` | **무조건 콘솔** (조건 제거) |
| 카운트 | `all`=전체 N명 / else=TOTAL N | **전체 N명** 하나 |
| 검색 | `all`=콘솔 검색 / else=`<input class=input>` | **콘솔 검색**(`customer-console-search`) |
| 공통 필터(담당자·진행1·2차) | `all`=renderConsoleFilter / else=`<select>` 3벌 | **renderConsoleFilter** (구식 select 삭제) |
| 필터 세트(mode 차이·유일) | — | `all`=계약가능성·관리상태 / 그 외=뷰 select 3개. 둘 다 `list-view-controls` 자리 |
| 테이블 서피스 | `isConsole ? console-table : table-scroll` | **console-table**(전 mode) |

### 뷰 select 3개 = `renderConsoleFilter` 일반화로 흡수 (SSOT)

`renderConsoleFilter`(`:825`)에 `includeAllOption` 파라미터를 추가한다:
- **필터용**(담당자/진행상태/계약가능성/관리상태): `includeAllOption: true` — 맨 앞에 빈값 "전체"(=label) 옵션, 빈값이면 비활성 톤.
- **뷰용**(담당자별/상담상태별/긴급순 보기): `includeAllOption: false` — "전체" 옵션 없음, 항상 뭔가 선택된 정렬/그룹 축.

pill 마크업·CSS(`console-filter-button` 등)는 **한 렌더러로 SSOT**. 뷰 select는 지금 옵션이 없어(mock) pill에 label만 표시되고 팝오버는 비어 있음 — 나중에 옵션 배열만 채우면 실동작. 동작 로직(실제 정렬/그룹)은 이 슬라이스 범위 밖(유슨생 "기능은 나중").

### SSOT 원칙 (반드시 준수)
- 컨트롤 rail JSX **한 벌로 수렴** — 구식 rail에 콘솔 스타일 복붙해 세 번째 변형 만들지 않는다.
- 테이블 서피스는 기존 `console-table`/`console-table-scroll`(controls.css, 배치 5 4-A) **재사용** — 새 CSS 0벌.
- 필터 pill은 `renderConsoleFilter` 한 렌더러 — 뷰 select용 별도 pill 마크업 만들지 않는다.
- CSS 클래스도 mode별 예외 신설 없이 기존 `customer-console-*` 공유.

### Safari select 함정
공통 필터가 구식 `<select>`(bindSelect)에서 `renderConsoleFilter`(버튼+팝오버, 네이티브 select 아님)로 바뀌므로 Safari onChange/onInput 함정과 무관해진다. 남는 네이티브 `<select>`(담당자 변경 팝오버 내부 등)는 기존 `bindSelect` 유지.

## 검증
- **전 mode 렌더 스모크**: 6 mode 각각 rail·필터 pill·담당자 변경 팝오버 정상 표시(팝오버 깨짐 해소 확인).
- **기존 회귀 테스트 유지**: 헤더 th = 데이터 td 컬럼 정합(`#248`에서 추가한 전 mode 테스트).
- **all 회귀 0**: `isConsole` 분기 제거가 전체 보기 기존 모습을 바꾸지 않는지 — 격리 스택 스크린샷 전/후 대조.
- **격리 스택 브라우저 스크린샷** 6 mode(실 데이터).
- typecheck·lint·unit·build.

## 범위 밖 (YAGNI)
- 뷰 select 실동작(정렬/그룹 로직) — 나중 슬라이스.
- delivery/settlement의 출고/정산 전용 데이터·컬럼 — 데이터화 슬라이스 몫.
- 클래스 리네임(customer-console-* → 중립).
- 헤더 타이틀/breadcrumb 통일(#223에서 정리됨 — all만 breadcrumb, 나머지 "·" 타이틀. 유슨생 범위 지정 밖).

## 기각안 (재제안 금지)
| 안 | 근거 |
|---|---|
| rail 배치 B(2줄 유지·톤만) | 유슨생 A(1줄) 채택 — 전체 보기와 100% 동일 문법 |
| 클래스 중립 리네임 | CSS 대량 변경 + 빌드 계산값 대조 비용 > 실익. "console"을 "운영툴 콘솔 톤"으로 재해석하면 이름도 어색하지 않음 |
| 뷰 select를 별도 pill 렌더러로 | pill 마크업 두 곳 = 시각 드리프트. renderConsoleFilter 일반화(파라미터 1개)가 SSOT |
