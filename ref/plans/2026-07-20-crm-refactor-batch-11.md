# 리팩토링 배치 11 — #295·#296 감사·판정·이행 SSOT (2026-07-20)

**범위**: 배치 10 이후 미감사 = **#295**(사이드바 리라우트, 2파일) + **#296**(출고 관리 2단계, 22파일) — 코드 24파일 +857/−27. main 직접 코드 커밋 없음(docs만).
**방법**: 관례대로 — 기준선 재실측(server 594 clean·unit 963 동일 트리) → 3앵글 병렬 감사(A 서버+순수 · B 클라 UI · C #295+크로스커팅) → **전건 적대 검증 3명**(반박 의무·인용 실존 확인) → **오케스트레이터 ground-truth 스팟 6지점**(activity 합집합·delivery_risk 스코프·contracting 삭제 가드·CSS 선언 순서·dismiss Escape 버블·테스트 삽입 순서 — 전건 검증관 판정과 일치·허구 인용 0, 파일명 오기 1건만 정정) → 판정 → PR 이행.
**판정 집계**: 후보 21(중 4→2·하 17) — **CONFIRMED 16 · ADJUSTED 5 · REFUTED 0**(B#8=C#4 중복 병합). 신성 규칙 6종 전수 clean(dealer 게이트 PUT 커버 실측 포함·V3 스팟 재검증 2건 일치) · knip 7/9 무드리프트 · spec 대조 §3~§5·§7·§9 일치.

## 판정 표

| # | 등급 | 주장 | 판정 | 이행 |
|---|---|---|---|---|
| A#1 | **중** | `customer_deliveries` 쓰기가 활동 파생(staffActivityAt) 합집합 미편입 — 출고 정보 저장이 관리 상태 배지·AI stale/delivery_risk에 무활동(#180 부류·delivery_risk는 계약완료만 조회 = 자기모순) | CONFIRMED | **PR1** — max(dl.updated_at) 1절 + activity.ts/manage-status.ts 주석 동기 + 잠금 테스트. A#5① 동반 필수(편입 순간 updated_at이 load-bearing) |
| A#2 | 하 | 비실존 날짜(2026-02-31)가 zod regex 통과 → PG 22008 → 500 + SQL 원문 노출(dbErrorMessage 폴스루 정적 추적 확정) | CONFIRMED | **PR1** — dbErrorMessage 날짜 범위 매핑 1줄 + date regex 리터럴 2벌 상수화 |
| A#3 | 하 | TOCTOU 경합 시 FK 23503이 삭제 어휘 문구로 오도(기능 봉쇄는 정확) | CONFIRMED·기록성 | **PR1** — 주석 각주만(문구 일반화는 삭제 경로 8콜사이트 흐림 — 비권장) |
| A#4 | 하 | contracting 테스트 updated_at↔created_at 축 미분리(`updated_at desc`→`created_at desc` 변이 무증상 — 배치 10 A#4 관례 위반) | CONFIRMED | **PR1** — 물리 삽입 순서 역전(신 먼저·구 나중) |
| A#5 | 하 | 그물 갭 2 — ①upsert 갱신 updatedAt 스탬프 무단언 ②미존재 quote id 400 분기 무테스트(제거 변이 = TypeError/FK 500 강등 침묵) | CONFIRMED | **PR1** — ①updatedAt 변화 단언(시계 스큐로 `>` 대신 not.toBe/`>=`) ②randomUUID 400 케이스 |
| A#6 | 하 | spec S2 "1:N 전환은 unique drop만(additive)" 서술이 코드와 상충 — drop 시 스칼라 서브쿼리 "more than one row"·onConflict 42P10로 읽기·쓰기 동시 파손 | CONFIRMED | **PR1** — spec S2 각주 정정(서브쿼리·upsert 재설계 동반 명시) |
| A#7 | 하 | cascade 자식 열거 3곳 스테일(customer-delete.ts:73 "6종"→7종·check-test-residue.ts:41 "5종"→6종·AGENTS.md "13테이블·증설 5"→14·6). 4번째 living-doc 지점 없음(V1 grep) | CONFIRMED | **PR1** — 3곳 갱신 |
| A#8 | 하 | 빈 폼 저장 시 sourceQuoteId 잔존(표시 5필드 null + provenance 비null 유령 행) | **ADJUSTED** — spec §5.3의 sourceQuoteId 전용 명문 규칙("기존 저장값 유지")의 정확한 구현 — "모순"이 아니라 '전 필드' 범위 문면 모호. 실해 0 | **PR1** — 주석·spec 각주 1줄만. 코드 변경(5필드 null 시 provenance도 null)은 §5.3 명문과 충돌 — 비권장 박제 |
| B#1 | **중** | 팝오버 입력에서 Enter → keydown 버블 → 행 Enter 핸들러가 드로어 오픈(+Esc 복구 시 dismiss 훅이 팝오버까지 닫아 초안 소실). 출고 예정 팝오버 동일 노출 | CONFIRMED — 단 **이행안 교정(V2)**: 무차별 stopPropagation은 dismiss 훅의 Escape 닫기(document **버블** keydown)를 죽이는 회귀 | **PR2** — 팝오버 2종에 **Enter 한정** stopPropagation + 테스트 |
| B#2 | 중→하 | delivery mode 표시(계약 차량)↔검색(needModel) 축 불일치 — "G80" 검색 0행 | **ADJUSTED**(등급 하향 — 발생 전제 이중·소수 행 큐. 배치 9 A#1 인용은 원칙 차용이지 동일 선례 아님) | **PR2** — delivery 한정 searchable에 contractVehicle 편입(baseRows가 mode를 이미 deps 보유 — 타 mode 오염 0) + 테스트 |
| B#3 | 중→하 | 견적 삭제 미리로드 → 죽은 견적 id 시드 → 저장 400 | **ADJUSTED** — 원 시나리오는 contracting 삭제 UI 가드(QuoteList:466-474)가 차단(감사 간과). **대체 경로 생존**: 저장된 delivery.sourceQuoteId 승계 → 마킹 해제 → 삭제(가드 통과·미리로드·DB는 FK SET NULL) → 재편집 저장 400 "다시 시도" 오도(새로고침만 해소) | **PR2** — deleteQuote 성공 시 onCustomerListChanged(대체 경로도 해소) + 테스트 |
| B#4 | 하 | setPrimaryScenario 미리로드 — contracting 대표 변경 시 lender 프리필 스테일("대표로" 버튼 도달 실재) | CONFIRMED | **PR2** — 성공 시 리로드 1줄(B#3과 동일 파일·문법) + 테스트 |
| B#5 | 하 | `.delivery-info-popover textarea`의 `font: inherit`(후행 shorthand)가 `font-size: 12px` 무효화 — textarea 11px·input 12px 불일치 | CONFIRMED — **삭제 금지 보강(V2)**: theme.css 컨트롤 font:inherit는 textarea 미포함이라 family 정규화 유일 경로 | **PR2** — 순서만 교체(`font: inherit; font-size: 12px;`) |
| B#6 | 하 | 출고 정보 그물 변이 무증상 4종(ⓐ성공 닫힘 — 출고 예정도 동일 갭 ⓑ배타 짝 ⓒ스크롤 닫기 ⓓnotice 행 귀속). 인용 정정: ⓓ는 Row:933이 아니라 **Page:933** | CONFIRMED | **PR2** — 최소 ⓐ(정보+예정 동반)·ⓒ 테스트 추가 |
| B#7 | 하 | startEditingNextAction만 delivery 팝오버 2종 안 닫는 배타 비대칭(mode 배타로 현재 도달 불가 — 잠복) | CONFIRMED | **PR2** — 대칭 2줄 추가(형제 6곳 문법 통일 — 드리프트 예방) |
| B#8=C#4 | 하 | 마킹 리로드가 false(리로드 실패) 무음 폐기 | CONFIRMED·**기록만** — 드로어 축은 타입 계약부터 `() => void`(6+ 콜사이트 전관례·notice 채널 부재). 콘솔 팝오버 축과의 계약 2벌 공존은 표면별 설계 차이로 일관 | 기록만(채널 신설 비권고 — 실익 미달. 드로어 false 처리 통일은 별도 UX 결정 선행) |
| C#1 | 하 | 팝오버 가시 타이틀 부재 — spec §6 "출고 정보(고객명 병기)" 드리프트 | **ADJUSTED — 해소 방향 역전(V3)**: 감사원의 "spec 정정" 근거는 경량형(출고 예정)과의 비교 클래스 오류. 이 팝오버는 폼형 자임이고 폼형 관례 3종(담당자 변경·고객 삭제·고객 등록) 전부 가시 타이틀 보유 + fixed 분리라 고객명 병기 실익(오행 편집 방지) 실존 | **PR2** — 타이틀 `<strong>출고 정보 — {name}</strong>` 추가(구현 픽스가 관례 정합) |
| C#2 | 하 | plan "머지 금지/보류" 스테일(:13·:27 — 실제 8b54b6f 머지) | CONFIRMED | **PR1** — 2곳 동기화 |
| C#3 | 하 | 주석 spec 절 인용 §4→§5.3 드리프트(delivery-info.ts:17·test:9 + 기원 plan:940 추가 발견) | CONFIRMED | **PR1** — 3곳 정정(+delivery-info.ts:5 헤더 §5.3로 좁힘) |
| C#5 | 하 | 날짜 필드는 빈 문자열 → 400(정규화 아님) — spec §4.2 문구 필드 축 무구분 | CONFIRMED(클라 방어로 실도달 0·fail-loud 정합 — 구현 변경 비권장) | **PR1** — spec §4.2 각주 1줄 |

**기록만 박제**: B#8=C#4(리로드 false 무음 — 드로어 전관례 수용) · B#3 원 시나리오는 도달 불가(UI 가드) — 대체 경로 서술이 정본 · #295 active 체크 잔존(pending 14 결정 선점 회피 — C 관찰) · plan Task 11 관찰 2건(CDP 일과성·낮은 뷰포트 스크롤 닫힘) 계속 유효.

**기각/비권장 박제(재제안 금지)**: A#8 코드 변경안(5필드 null 시 sourceQuoteId null — spec §5.3 명문과 충돌) · A#3 문구 일반화(삭제 경로 8콜사이트 흐림) · B#5 `font: inherit` 삭제(textarea family 정규화 유일 경로) · B#1 무차별 keydown stopPropagation(Escape 닫기 회귀). 배치 7~10 기각 박제 계속 유효.

## 이행

- **PR1(서버+순수+문서 정합)**: A#1(+A#5① 동반)·A#2·A#3 각주·A#4·A#5②·A#6·A#7·A#8 각주·C#2·C#3·C#5 + 이 plan 박제
- **PR2(클라 콘솔)**: B#1·B#2·B#3·B#4·B#5·B#6·B#7·C#1
- 머지는 유슨생 지시 대기(PR 생성까지 — 2026-07-20 "pr 열어서" 지시)

## 진행 상태

- [x] 감사 3앵글·적대 검증 3명·ground-truth 스팟 6지점·판정 확정
- [ ] PR1 이행
- [ ] PR2 이행
- [ ] 통합 검증(typecheck·lint·unit·server·build·knip)
