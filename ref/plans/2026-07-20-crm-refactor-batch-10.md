# 0720 리팩토링 배치 10 — 감사 결과 · 실행 계획

Last updated: 2026-07-20 (유슨생 세션 — **✅ 전량 이행 완료**: 기준선 #290 + PR-A #291 + PR-B #292 + PR-C #293 squash 머지 · octopus 통합 검증 typecheck 0/lint 0/unit 943/server 584/build/knip 7/9 · **판단 대기 2건 유슨생 결정 → 후속 PR로 이행**(B#9=① suppress형 5벌 공용 훅 `useTablePopoverDismiss` · B#10=ⓐ spec §5.4 정정+date input stale 동반))

**범위**: 배치 9(#281·#282·`9cecddf` 감사 + 실행 산물 #283~#285) 이후 미감사 구간 = **#286(인사이트·지식베이스 캐시+진입점 `ef48280`)·#287(카운트 깜빡임 `d5e0459`)·#288(출고 관리 콘솔 1단계 `6077e3d` — 커밋 19개·코드 33파일 +4,350)·#289(콘솔 팝오버 fixed+flip-up 확산 `1fda751`)**. 코드 37파일. docs [skip ci] 커밋 3건은 코드 아님(범위 밖 누락 코드 커밋 0 — C 실측).

**방법**: 3앵글 병렬 감사(A #288 서버+순수 · B #288 UI+#289 · C #286·#287+크로스커팅) → **전건 적대 검증 3명**(반박 의무) → **오케스트레이터 ground-truth 스팟 6지점**(배치 9 관례 — reloadCustomers false 반환·:858 미검사·scheduled_time=text·toggleChancePopover extra 누락·kst-date.ts "별개 유지" 헤더·카운트 삼항 바깥, 전부 검증관 판정과 일치) → CONFIRMED/ADJUSTED/REFUTED → PR 이행.

## 기준선 실측 (2026-07-20)

- **🔴 착수 시점 test:server 1 fail 발견 → 즉시 복구(#290 squash `1ce5f86`)**: `quote-requests.test.ts` 역방향 가드 테스트의 시드가 `limit(1)`(임의 행)로 뽑은 실 고객에 `app_user_id`만 세팅 — 그 고객이 phone 보유면 `customers_phone_app_exclusive_check`(마이그 0034)가 UPDATE 거부 → ConflictError 단언 전 tx 사망. psql 실측 = 현재 limit(1)이 김민준(phone 보유) 반환. **0034 적용(07-17) 이후 heap 순서 운으로만 통과해 온 잠복 픽스처 결함의 발현**(서버 코드 회귀 아님). 픽스 = 시드에 `phone: null` 동반(연결 고객 = phone NULL이 #276 계약 정합 상태). 같은 부류 전수 스캔 = 이 1곳뿐(ai-hint 2곳은 자가 픽스처·phone 미설정).
- 복구 후: `typecheck` **0** · `lint` **0** · `test:unit` **935**(#289 +5 포함) · `test:server` **582 pass/0 fail**(실 master·잔재 0) · knip **unused export 7·type 9**(baseline 정확 일치 — C 실측).
- **신성 규칙 6종 전수 clean**(세 감사원 교차 실측): Safari select(신규 select 0 — 팝오버는 텍스트 input+버튼)·profiles 쓰기 0(서버 diff = SELECT 서브쿼리+픽스처 registry뿐)·Workers fetch 0·dealer 게이트(신규 라우트 0)·서버→클라 import 경계(신규 = `client/src/data/customers` 순수 상수만·서버가 delivery-console/datetime-text import 0)·픽스처 registry(`CU-DLVR-` 등록 정합).
- **문서 정합 전수 일치**(C 스팟 7): spec D1~D9↔구현·마이그 0035=CHECK만·plan 완료 마커·pending 항목 13(가정 5건 1:1)·#287 라벨 게이트·(B) 목업 제거 완결.

## 감사 총평

- 후보 **17건 = 중 2 · 하 15**. 판정: **CONFIRMED 9 · ADJUSTED 6 · REFUTED 1** + 기준선 픽스 1(#290 — 표 밖). 정합성 실버그(지금 오답)는 B#1(리로드 실패 무처리·발생 조건부)과 C#1(에러 시 카운트 "0")뿐, #288 코어 배선(팝오버 상호배타·잔존 필터 게이트·fixed 전환·DateTextField 이중 모드·서브쿼리↔클라 파생 의미론)은 전수 clean.
- **허구 인용 0**(배치 9와 대조적 — 검증관 전건 재확인·경로/라인 오차 2건뿐). ground-truth 스팟도 전건 일치.

## 감사 후보 인벤토리 + 판정 (2026-07-20 확정)

| id | [급] 제목 | 판정 | 요지 |
|---|---|---|---|
| A#1 | [중→하~중] 일정 CRUD scheduleBody 자유형 z.string() — 포맷 게이트 부재 | **ADJUSTED·이행** | 검증관 psql 실증으로 **날짜 축 불성립**(`scheduled_date`=date 타입 — PG가 저장 정규화+json ISO 렌더라 오염 불가). **time 축만 성립**(`scheduled_time`=text — "9:30" verbatim 저장 시 사전식 대표 선정·클라 정렬 동시 오답 + 저장 영구). 현 3표면(팝오버 normalize·드로어 select 조합) 전부 정규라 잠복. 같은 라우트가 `type`은 게이트하는 비대칭 + 출고 2단계(일정 인접 표면 증설) 임박이 채택 근거. 픽스 = zod regex 게이트 2줄(time `HH:mm`·date `YYYY-MM-DD` — date는 400-화 정중함) |
| A#2 | [하] overdue 방어 반쪽(라벨 재조립 ↔ 컴퍼레이터 raw) | CONFIRMED·**각주만** | 도달 불가가 **타입 수준 보장**(date 컬럼+json ISO)이라 컴퍼레이터 방어 복제는 도달 불가 코드 증식. A#1 게이트가 time 축을 경계 봉쇄 — 이중 방어 불필요. 각주 1줄로 종결 |
| A#3 | [하] KST 산술 3벌 공유화 | **REFUTED** | 클라 2벌은 **다른 산술**(날짜 문자열 vs 달력일 인덱스 — 공유 커널은 +9h 관용구뿐)·유일 위험 쌍(manage-status↔서버)은 #204 파리티 테스트 기잠금·`kst-date.ts:1-4` 헤더가 "출력 포맷 달라 별개 유지" 기결정 박제. #191류 과추상화 — **재제안 금지** |
| A#4 | [하] 서브쿼리 3차 tie-break(created_at asc) 무잠금 | CONFIRMED·이행 | 동일 (date,time) 2행에서 대표 id(팝오버 PATCH 대상) 결정론이 계약인데 픽스처 0 — `, s.created_at asc` 제거 변이 전 테스트 통과. 중복 경로 실재(드로어 type select에 '출고' 포함). **⚠️픽스처 함정: 한 insert 문(VALUES 배열)이면 `now()` 트랜잭션 스코프라 동일 created_at — 반드시 별도 문장 2회** |
| A#5 | [하] normalizeDateText 혼합 구분자·연도 무제한 | ADJUSTED·**기록만** | 혼합 구분자("2026-7.19")는 실패 모드 부재로 기각(수용값 전부 실존 검증 후 정규 ISO). 연도 상한만 절반 성립(콘솔 셀 라벨 `${m}/${d}`가 연도 은닉 — 미래 오타 무자기노출) — 개연성 창은 제품 판단 딸린 저우선 폴리시 |
| B#1 | [중] 출고 예정 저장/삭제 — 리로드 실패 boolean 유실(#234 규약 절반 이식) | **CONFIRMED·이행** | App `reloadCustomers`는 reject 없이 false 반환 → `:858`/`:878` `await onCustomerListChanged()` 미검사라 catch 도달 불가 → 저장 성공+리로드 실패 시 팝오버 닫힘(성공처럼)+행 stale → 재저장이 create 해석 = **'출고' 2행 실생성(DB 영구 — UI 대표 승계가 표시만 치유)**. deleteSelected·submitAdvisorChange는 `ok===false` 처리(대조군). **⚠️픽스 형태: deleteSelected 미러(fire-and-forget) 불가** — deliveryNotice는 열린 팝오버 안에만 렌더라 닫으면 표시될 곳 없음 → `ok===false`면 **팝오버 유지+notice+return**(재저장 유도 차단 겸용) |
| B#2 | [하] 실패 notice 행 오귀속(단일 스칼라 state) | CONFIRMED·이행(B#1 동반) | `:860` 주석이 교차 행 열림을 기인정(open/saving은 가드·notice만 누락 — `b33931a` 잔여 갭). B#1 픽스(팝오버 유지형)가 notice 생존 시간을 늘려 표면 빈도 증가 → 같은 PR에서 `deliveryNotice`를 `{no, message}` row-key화 |
| B#3 | [하] toggleChancePopover만 setOpenExtraFor(null) 누락 | CONFIRMED·이행 | 형제 토글 5곳 전수 대칭·이것만 누락(선재 — `6077e3d^` git 실증, #288이 delivery 줄 추가하며 답습). extra와 동시 오픈 → 외부클릭 1회에 extra만 닫힘(stopImmediatePropagation 선점). 1줄 |
| B#4 | [하] fixed 팝오버 resize 미추적(분리 부유) | ADJUSTED·이행 | spec/plan/PR에 resize 언급 0 = 박제된 트레이드오프 아닌 미비. 단 실해 하향 — 분리돼도 기능 정상(옵션 클릭은 상태 키 기반)·외부클릭 1회 소거·발생 희소. 픽스 = scroll 미러 resize 닫기 1줄×3 effect(stage/chance/delivery) |
| B#5 | [하] `:has` z:90 캡핑 룰 2건 목적 상실(absolute 잔재) | ADJUSTED·**기록만** | 캡핑 실재(양 앵커 relative)하나 **무해 기하 실증**(chance 팝오버 폭 70px·final-update 말풍선 도달 329px < 수평 이격 ~371px·타 행 경쟁은 tr 레벨 결정·delivery 무캡 대조군 정상). 제거는 라이브 computed z 변경이라 #207류 증명으로 부족 — **다음 dead-CSS 배치에서 스태킹 동치 논증 동반 일괄**(재제안 금지 아님) |
| B#6 | [하] delivery 잔존 statusGroup/status 게이트 잠금 0 | CONFIRMED·이행 | 테스트 주석 스스로 "코드 리뷰로 확인" 자백·`? "" :` 제거 변이 전 테스트 green 확정(검증관 재검증). 픽스 = all에서 1차 필터 → rerender delivery → 표시 단언(rerender 관례 :444-453 실존) |
| B#7 | [하] delivery 팝오버 스크롤 닫기(원조 T13) 미잠금 | CONFIRMED·이행 | #289가 미러(stage/chance) 테스트만 추가하고 원조 안 잠금 — fireEvent.scroll 2건 실측. 3줄 미러 |
| B#8 | [하] useFixedPopoverPosition 앵커 미발견 시 영구 hidden fail-silent | CONFIRMED·이행 | 현 3소비처 도달 불가(팝오버 전부 앵커 서브트리)·위험은 재사용 시(독스트링이 미발견 계약 침묵). 계약 주석 1줄(공용화 이식 시 따라감) — dev warn은 선택 |
| B#9 | [하] 외부닫기 effect 8벌·suppress 5벌 복제 | ADJUSTED·**유슨생 판단 대기** | suppress 5벌 **md5 완전 동일** 실측이나 8벌은 3분화(단순 2·suppress 5·저장 1) — "8벌 통합" 기각. `usePopoverDismiss.ts:13`이 첫 클릭 소비 패턴 의도적 제외 박제 + capture 상이라 기존 훅 확장 불가. 옵션 = ①suppress형 5벌 한정 신설 훅(scrollClose 1옵션·resize 얹으면 3벌 중복 수정 회피) ②최소판 suppressOutsideClick 단일 함수화 ③현행 유지 |
| B#10 | [하] spec §5.4 "취소" 버튼 부재(무음 이탈 — plan 무기록) | ADJUSTED·**유슨생 판단 대기** | 옵션 리스트형 팝오버(진행상태/가능성)는 무취소가 관례이나 **폼형은 콘솔 전부 명시 취소 보유**(담당자 변경·삭제 확인·고객 등록·메모 에디터) — 출고 팝오버는 폼형. 2안: ⓐspec 문구 정정(같은 줄 "date input"도 stale — DateTextField 전환 미반영, 동반 정정) ⓑ취소 버튼 추가(관례 정합) |
| C#1 | [하] listError 시 총 카운트 "0" 확정 표기 — #287 계약("0은 정말 0건만") 정면 모순 | CONFIRMED·이행 | 카운트가 에러 삼항 **바깥** 상시 렌더(본문 "불러오지 못했습니다" + 카운트 "0" 동시 표시). 픽스 = `loading \|\| listError ? "" : items.length` 양 페이지 + 에러 테스트 |
| C#2 | [하] KnowledgeBasePage 카운트 게이트 무테스트(테스트 주석 "미러 동일" 주장만) | CONFIRMED·이행(C#1 흡수) | KnowledgeBasePage.test.tsx 부재 실측. C#1 픽스에 로딩+에러 테스트 2건 동반 신설 |

## 실행 — PR 3개(+ 기준선 #290 기머지)

### PR-A — 서버+순수 (A#1 · A#2 각주 · A#4)
- **A#1**: `src/routes/customers.ts` scheduleBody에 `scheduledDate` `/^\d{4}-\d{2}-\d{2}$/`·`scheduledTime` `/^([01]\d|2[0-3]):[0-5]\d$/` regex 게이트(nullable/optional 유지). TDD: 비정규 body 400 서버 테스트 RED 실관찰 → GREEN.
- **A#2**: `delivery-console.ts` 컴퍼레이터에 "raw 비교 = 서버 date 타입 보장 전제·time은 zod 경계 봉쇄" 각주 1줄.
- **A#4**: `customers.next-delivery.test.ts` 동일 (date,time) 2행 tie 픽스처(**별도 insert 문 2회** — now() 트랜잭션 스코프 함정) + 대표 id = older 단언.

### PR-B — 클라 콘솔 정합 (B#1+B#2 · B#3 · B#4 · B#8) + 그물 (B#6 · B#7)
- **B#1+B#2**: saveDeliverySchedule/deleteDeliverySchedule — `const ok = await onCustomerListChanged(); if (ok === false) { setDeliveryNotice(...); return; }`(팝오버 유지) + `deliveryNotice` `{no, message}` row-key화. TDD: 리로드 false 시 팝오버 잔존+notice 테스트 RED → GREEN.
- **B#3**: `toggleChancePopover`에 `setOpenExtraFor(null)` 1줄.
- **B#4**: 스크롤 닫기 effect 3곳에 resize 닫기 1줄씩.
- **B#8**: `useFixedPopoverPosition` 독스트링에 "앵커 미발견 = 영구 hidden(fail-silent)" 계약 명시.
- **B#6·B#7**: 게이트 rerender 테스트 + delivery 스크롤 닫기 테스트(변이 실관찰).

### PR-C — 콘텐츠 카운트 (C#1+C#2)
- 양 페이지 `loading || listError ? "" : items.length` + InsightsPage 에러 테스트 + KnowledgeBasePage.test.tsx 신설(로딩·에러 2건). TDD RED → GREEN.

## 유슨생 판단 대기 → ✅ 전량 결정·이행 (2026-07-20 후속 PR)
- **B#9 = ① 채택(유슨생)**: suppress형 5벌 한정 공용 훅 `useTablePopoverDismiss`(CustomerManagementPage 파일 레벨 — 소비처가 이 파일뿐). 옵션 = `closeOnViewportShift`(fixed 3종만 true — 스크롤+리사이즈 닫기). `isTableControlTarget` 파일 레벨 승격 동반. finalUpdate ai-hint pointerover 특례는 별도 effect 잔류. onClose는 useCallback([]) 안정 참조 — 열림 중 재구독 0(구 코드는 stage 레벨 전환마다 재구독하던 것보다 오히려 개선). 단순형 2벌·저장형 1벌은 스코프 밖 유지(검증관 3분화 실측 존중). 행위 무변경 증명 = 기존 페이지 테스트 그물 72(외부닫기·suppress 재오픈·Escape·scroll·resize·extra 전환) 전부 GREEN.
- **B#10 = ⓐ 채택(유슨생)**: spec §5.4 문구를 구현에 정합(취소 버튼 없음 — 닫기 = 외부 클릭/Esc) + 같은 줄 "date input" stale(DateTextField 전환 미반영) 동반 정정. 재론 트리거(실사용 어색 시 ⓑ 버튼 추가 — 폼형 관례 논거) 각주 박제.

## 기록만
- **B#5** z:90 캡핑 잔재(무해 기하 실증 박제 — 다음 dead-CSS 배치에서 스태킹 동치 논증 동반 일괄. 트리거 = 팝오버 폭 확대·행 내 신규 고z 요소).
- **A#5** normalizeDateText 연도 개연성 창(저우선 폴리시 — 콘솔 셀 라벨 연도 은닉 논거만 성립).

## 🚫 기각 박제 (재제안 금지)
- **A#3** KST 산술 클라 공유 모듈(다른 산술 2벌·유일 위험 쌍 파리티 기잠금·kst-date.ts "별개 유지" 기결정) · **A#5 혼합 구분자 거부**(실패 모드 부재 — 수용값 전부 실존 검증 후 정규 ISO) · **A#2 컴퍼레이터 방어 통일**(도달 불가 코드 증식 — 각주로 종결) · **B#9 8벌 통합**(3분화 실측 — suppress형 5벌 스코프만 열림). 배치 7~9 기각 박제 계속 유효.

## 프로세스 노트
- 배치 9 신뢰도 문제(허구 인용)는 재발 0 — 프롬프트에 "인용 전 존재 확인·허구 = 보고 폐기"를 명시한 효과로 추정. ground-truth 스팟 관례는 유지(이번에도 6지점 수행·전건 일치).
- **기준선은 착수 시점에 반드시 재실측**: 이번 배치가 그 관례로 0034 잠복 픽스처 결함(#290)을 감사 시작 전에 잡았다. 공유 master의 heap 순서는 통제 밖 — `limit(1)` 무정렬 픽스처는 발견 즉시 계약 정합 상태로 고정할 것.
