# 0718 리팩토링 배치 8 — 감사 결과 · 실행 계획

Last updated: 2026-07-18 (유슨생 세션 `0718-fresh-start` — 감사·적대 검증 완료, 이행 착수)

**범위**: 배치 7(#258~#265 감사 + 실행 산물 #266~#272) 이후 미감사 구간 = **#273(판매사 select)·#274(상담 신청 DB 인박스)·#275(buildPayload 추출)·#276(전화번호 소유권)·#277(세그먼트 폭) + main 직접 polish `61b28d5`·`b618b25`(연락처 UI)**. 커밋 `fe6b745..e373665`, 코드 65파일(+5,977/−217, ref/ 제외).

**방법**: 4앵글 병렬 감사(A 판매사 #273 · B 인박스 #274 · C 전화번호 #276+폴리시 · D 소형 #275/#277+크로스커팅·기준선) → 후보 취합(중복 1건 병합) → **전건 적대 검증 4명**(반박 의무) → CONFIRMED/ADJUSTED/REFUTED → PR 분할 이행.

## 기준선 실측 (2026-07-18)
- `bun run typecheck` **0** · `bun run lint` **0** · `bun run test:unit` **802 pass/0 fail**(89파일) · knip **unused export 8·type 10**(배치 7 baseline 7·9 대비 +1·+1 — 신규 2건은 C#3·D#2로 판명, 이행 시 baseline 복원).
- 실 DB 실측: CHECK `customers_phone_app_exclusive_check` 실존·위반 0행·비숫자 phone/secondary 0행·픽스처 잔재 0.

## 감사 총평
- 후보 **18건 = 상 0 · 중 3 · 하 13 · 기록 2**(+유슨생 확인 1). 적대 검증 판정: **CONFIRMED 14 · ADJUSTED 4 · REFUTED 0** — 감사 정밀도가 높았던 배치(기각 0). 최대 발원지는 #273/#274 신규 표면.
- **신성 규칙 5종 전수 clean**(D 실측): Safari select(신규 select 2곳 — 계산기 딜러 bindSelect·워크벤치 딜러 uncontrolled+key)·서버→클라 import 신규 0(`solution-dealers.ts`는 http 체인이라 의도 분리 — 모범)·Workers fetch plain call(dealers 릴레이 지역변수 호출+#202 주석)·public write 0·dealer 게이트 정합(#274 "서버 변경 0" 주장 참).
- **#275·#277 clean**: buildPayload 추출 행위 보존(축자 이동·34 테스트)·fingerprint ⊆ 원칙 성립(15키 전수 등록)·#277 `.calculator-modal` 스코프 준수·3열 2fr/1fr/2fr 산술 동치·dead 잔존 0·주석 박제 실존.
- **#276 계약 준수 전수 clean**(C 실측): phone write 경로 5곳 전부 계약 준수·read-through 누락 표면 0·digits 정규화 누락 라우트 0·droppedPhone 배선 완결·인박스 `!appUserId` 제외 양 표면(서버 quote-requests.ts:148·클라 consultation-inbox.ts:71)·AGENTS.md 계약 서술 전부 코드 일치.
- 마이그 0033·0034 4계층 동형·crm만·0034 백필 UPDATE가 CHECK 앞(올바른 순서).

### 감사 후보 인벤토리 + 적대 검증 판정 (2026-07-18 확정)
| id | [급] 제목 | 판정 | 검증 요지 |
|---|---|---|---|
| A#1 | [중] 계산기 브랜드 전환 후 구 브랜드 딜러 ScenarioState 잔존 → 재조회 payload 무음 동봉 | **CONFIRMED** | 방어 전무 실측(브랜드 effect는 dealers만·resetEpoch 초기화 전용·fingerprint는 통로). lenderCode 게이트는 브랜드 축 원리적 불방어(`lenderCode::dealerName` 합성에 브랜드 정보 없음). 같은 PR의 워크벤치는 `resetCardDealer`(useQuoteWorkbench:792-809) 방어 실존 — 비대칭. **제프 서버 실측: BNK 브랜드 스코프 미매칭 → policyBaseIrr 0.0681 하드 폴백** = 빈 select인데 결과 금리가 달라지는 무음 오계산. 메리츠는 fee 0(비제휴 동치)이 아니라 `lookupDealerHeadFee` dealer 단독 키 head fee 오적용(조건부). 제프 main 755477b 현재도 미수정(#67 8건 미포함) — 제프 공유 후보. 수정 = 워크벤치 미러(prevBrand 구분·dealer 값만 리셋·dealerType 모드 유지) — membership 검증안은 union fetch in-flight 경합으로 비결정이라 기각 |
| A#2 | [하] 딜러 fetch 실패가 "등록 딜러 없음" 데이터-부재 어휘로 표기(계산기+워크벤치) | ADJUSTED | 메커니즘 전부 성립(계산기 `catch(()=>[])` warn 0·워크벤치 실패를 캐시 키 기록해 성공 모양·옵션/색상의 배치 7 A#1 표면화와 비대칭). **정정: "등록 딜러 없음" 어휘는 CRM 신설(#273 dealerSelectPlaceholder — 제프는 "선택" 고정)**, 원형 상속은 조용한 catch까지만. 수정 유의: 계산기는 사별 부분 실패 허용이 의도(:92-93 주석) — 전사 실패 판별 설계 필요 |
| B#1 | [중] 60s 폴링 1회 실패가 로드된 목록을 통째로 에러 문구로 대체(ConsultationRequestsPage+AppRequestsPage 원형 상속) | **CONFIRMED** | catch→setError→렌더 error 최우선이 rows 대체·카운트 "—"·승격 버튼 증발. 자기 치유 ≤60s 실존하나 백그라운드 폴이라 자발성·"새로고침해 주세요" 오도 문구. useReadonlyContent는 폴링 미커버 — rows-aware 게이트(`error && 데이터 없음`일 때만 전체 에러)가 맞는 픽스. **AppRequestsPage 동시 수정 = 범위 내**(#252 미러 동시 수정 선례+:31 미러 계약 주석) |
| B#2 | [하] `firstLoadRef` 목적 상실 — deps `[]`라 prod dead·dev StrictMode 프리패치 캐시 우회 | CONFIRMED | 재마운트 force 의도 가설은 ref 소멸로 원리적 불성립 — dead 확정. 원형 AppRequestsPage는 deps `[signal]`이라 ref load-bearing(대조 정확) |
| B#3 | [하] link 충돌 인라인 안내 텍스트 클릭이 행 펼침 토글 | CONFIRMED | currentTarget 가드는 키보드 전용(:84-85) — 마우스 :176 onClick 무가드라 반박 기각. 원형은 행 onClick 자체 없음 — #274 고유 신규. wrapper `onClick={stopRowToggle}` 한 줄 |
| B#4 | [하] 테스트 사각 — 매칭 first-wins·NaN 날짜 정렬 미잠금 | CONFIRMED | 기존 "우선" 테스트는 키가 달라 first-wins 미접촉·findPhoneDuplicate는 다른 함수. **보강: first-wins가 뽑은 matchedCustomerId가 handleLink의 link 대상 인자로 흘러가는 행위 계약** — 잠금 가치 상향 |
| C#1 | [중] 추가 연락처(phone_secondary) 클리어 UI 경로 부재 | **CONFIRMED** | 빈 제출 no-op(useCustomerWorkflow:172)이 유일 경로 + **return이 setOpenEditor(null) 이전이라 popover도 안 닫힘**(저장 버튼 고장처럼 보임). 서버 null 클리어 실재(phoneField·테스트 잠금). "지울 일 없다" 박제 부재 — spec §1이 오히려 일시적 실무 케이스로 정의해 제거 수요 뒷받침 |
| C#2 | [하] resolvePhoneOnLink — secondary==appPhone && current≠appPhone 조합에서 중복 병기+실번호 droppedPhone 폐기 | ADJUSTED·**채택** | bun 직접 실행 재현 성공. 단 **spec §3-4 문언 준수**(secondary 다르면 phone 폐기+droppedPhone 표면화 — 무음 아님)·**견적요청 인박스 경로는 도달 불가 실측**(requesterPhone=profiles.phoneNumber라 current==appPhone 강제) — 남는 건 상담 인박스 legacy form≠profile+"상담사가 앱 번호를 미리 secondary에 기입" 이중 전제. 결함→스펙 §3-4 각주 개정 동반 개선 후보로 강등 → **유슨생 채택 결정(2026-07-18): secondary==appPhone이면 점유가 아니라 중복으로 판정, current를 그 자리에 보존(droppedPhone 없음). PR3 편입 + 스펙 각주 개정 동반** |
| C#3/D#1 | [하] `assertAppUserLinkable` unused export(knip +1) | CONFIRMED | 외부 참조 0 실측(두 link 라우트는 applyAppUserLink만 import — #276 수렴의 산물). export 제거 → knip 8→7 |
| C#4 | [하] plan T5 "검색 포함 유닛" 선언 vs 미구현 — phoneSecondary 검색 잠그는 테스트 0건 | CONFIRMED | plan `[x] 유닛 3` 중 검색 포함만 0건. 간접 잠금 없음. **유닛은 하이픈 포맷 질의로 작성**(searchable에 포맷값 편입) |
| C#5 | [하] link·PATCH TOCTOU 잔여(이론적) — CHECK 23514 시 문구 generic | CONFIRMED | 23505 constraint 전용 문구 선례 실재(shared.ts:30)·23514는 "허용되지 않는 값입니다" 500. 최후 방어선(unique·CHECK)이 정합을 지켜 **수정 = 문구 매핑 한 줄만**("3문장"은 4문장 오기·결론 무영향) |
| C#6 | [하] promotion-embeds.ts:14 주석 stale("link는 app_user_id·phone만 세팅") | CONFIRMED | 실코드는 phone(null)+phoneSecondary도 세팅. 결론(재임베딩 제외)은 유효 — EMBED_KEYS에 셋 다 부재 실측. 한 줄 정정("불가능 주석은 근거를 판다" #209 선례) |
| C#7 | [하] `.kim-phone-stack` CSS 규칙 0 dead className | CONFIRMED | CSS 규칙·JS 셀렉터·테스트 조준 전부 0(`-copy`만 실존). 제거 무위험 |
| C#8 | [하] 묶음 카드 아이콘 58px 칼럼 클릭 dead zone | ADJUSTED→**기록** | 관찰 실재(hover 어포던스는 카드 전체·아이콘 클릭 무반응)하나 편집 타깃 2개라 구조적 불가피 + 유슨생 픽셀 컨펌(b618b25) 직후 — **폴리시 백로그, 이번 배치 비이행** |
| C#9 | [하] 목록 병기 — phone 공란+secondary 존재 시 선행 `" · "` | CONFIRMED | Row:44 템플릿 재현. 현 DB 도달 0건(잠재)이나 수기 등록 phone optional+추가 연락처 편집 무게이트라 상담사 일상 조작으로 도달 가능. `filter(Boolean).join(" · ")` 1줄 |
| C#10 | [하] 공유 master 잔존 — 김민준 CU-2605-0020 phone_secondary=01012334444(07-17 19:40 KST) | CONFIRMED·**유슨생 확인 대기** | 전 DB에서 secondary 보유 행 이 1건뿐. 브리프 박제 잔여(제임스 updated_at)와 별개. 정황상 0717 폴리시 세션의 유슨생 dev 테스트 데이터 — 의도 아니면 제거(C#1 이행 후 UI로 가능·psql도 고아 위험 없음) |
| D#2 | [하] `ConsultationInboxItem` unused exported type(knip +1) | CONFIRMED | 내부 2곳뿐·간접 소비 0·noEmit이라 안전. 제거 → knip 10→9 |
| D#3 | [하] phoneSecondary 편집기 aria-label "연락처 수정" 고정(브리프 잔여 ⓑ 소진) | ADJUSTED | 실재·이행 적정. **픽스는 label prop 추가가 아니라 aria-label 삭제** — input이 정확한 `<label>`(`${fieldLabel(key)} 수정`) 안에 래핑돼 있어 하드코딩 aria-label이 도리어 덮는 구조. 삭제 시 phone 쪽 accname "연락처 수정" 유지 → Playwright 스펙(customer-detail-screenshot.spec.ts:105) 비파괴 |

## 실행 계획 — PR 3분할 (파일 서로소·병렬 가능)

### PR1 — 계산기·워크벤치 딜러 정합 (A#1 + A#2)
- **A#1**: CalculatorModal 브랜드 전환 시(선행 브랜드 존재 && 변경) 3 시나리오 `dealer:''` 리셋 — 워크벤치 `resetCardDealer` 미러(prevBrand 구분·값만 리셋·dealerType 모드 유지, 재열기 상태 유지가 와도 prevBrand 구분이 load-bearing). 제프 대비 의도 이탈 주석 박제.
- **A#2**: 계산기 — 전사 실패 판별(사별 부분 실패 허용 유지) → placeholder "딜러 목록을 불러오지 못했습니다" + console.warn. 워크벤치 — 실패를 빈 목록(성공 모양)으로 키 기록하지 않고 실패 상태로 구분 → 동일 실패 어휘. `dealerSelectPlaceholder` 계약 확장 + 유닛.

### PR2 — 인박스 정합 (B#1 + B#2 + B#3 + B#4 + D#2)
- **B#1**: 양 페이지 rows-aware 에러 게이트 — 데이터 보유 시 폴 실패는 테이블 유지, 전체 에러 문구는 무데이터일 때만.
- **B#2**: firstLoadRef 제거·`load(false)` 고정 + 주석. **B#3**: conflict wrapper `onClick={stopRowToggle}`. **B#4**: first-wins(미연결 동번호 2명)·NaN 날짜 정렬 테스트. **D#2**: `ConsultationInboxItem` export 제거.

### PR3 — 전화번호 도메인 마무리 (C#1 + C#2 + C#9 + C#5 + C#6 + C#3 + C#4 + C#7 + D#3)
- **C#2(유슨생 채택)**: `resolvePhoneOnLink`에 secondary==appPhone 중복 판정 분기(current 보존·droppedPhone 없음) + 테스트 1건 + spec §3-4 각주 개정.
- **C#1**: phoneSecondary 편집기 빈 제출 = 클리어(`{phoneSecondary: null}`)·popover 닫힘 — phone(주 번호)은 기존 no-op 유지(계약 불변). **C#9**: Row 병기 `filter(Boolean).join(" · ")`. **C#5**: shared.ts `customers_phone_app_exclusive_check` 23514 문구 매핑 한 줄. **C#6**: 주석 정정. **C#3**: export 제거. **C#4**: 검색 phoneSecondary 유닛(하이픈 포맷 질의). **C#7**: dead className 제거. **D#3**: aria-label 삭제.

## 제품/데이터 결정 — 전량 해소 (2026-07-18 유슨생)
1. **C#2**: **채택** — PR3 편입(위 표·PR3 절 참조).
2. **C#10**: **유슨생 dev 테스트 데이터로 확인 — 존치**(김민준은 시범 고객·병기 UI의 살아 있는 예시 겸. 제거 원하면 C#1 이행 후 UI로 가능).

## 기록만 (이번 배치 조치 불필요)
- **C#8** 묶음 카드 아이콘 dead zone — 폴리시 백로그(아이콘 클릭=주 번호 편집 위임안). 재론 트리거 = 실사용 혼동 리포트.
- **D#4** "payload 키 ⊆ fingerprint 키" 기계 잠금 — Proxy read-tracking은 조건부 읽기 미관측이라 거짓 안심(비권장). 현재 위반 0·#275 순수화로 정적 재감사 용이.
- **D#5** A#2/A#8 가드 배선(ConditionCards:168) 컴포넌트 계층 무테스트 — fail-loud 백업 실존·거대 컴포넌트 수동 검증 관례 안.
- (B 관찰) quote-request 서버 phone 매칭(quote-requests.ts:155)이 raw 동등 비교 — 실데이터 정규형이라 현재 무해.
- (C 관찰) 목록 검색이 하이픈 포맷 기준이라 연속 숫자 질의(01012345678) 미매칭 — #276 이전부터의 기존 동작, 회귀 아님.
- **제프 공유 가치**: A#1(브랜드 전환 딜러 잔존 — 제프 prod 실존·BNK 하드 폴백)·A#2 조용한 catch. 전달은 유슨생/이사님 채널.

## 🚫 기각 박제 (재제안 금지)
이번 배치 REFUTED 0. 배치 7 기각 4건(C#5 렌트 12개월·C#6 저장 >100% 무음·D#1 폰트·D#3 라벨 zip)과 C#1 스냅샷 정책(현행 유지 종결)은 계속 유효.
