# 0717 리팩토링 배치 7 — 감사 결과 · 실행 계획

Last updated: 2026-07-17 (유슨생 세션 `0717-rest-refactoring` — **전량 완료**. 후보 32 → CONFIRMED 19 · ADJUSTED 9 · REFUTED 4. 유슨생 결정: 전량 이행 + B#2 구 계약 복원. 이행 6PR 전부 squash 머지: ✅PR5=#266 `32d34f0`(D#2·C#3) · ✅PR3=#267 `64eed2b`(B#1·B#2·B#4·B#5) · ✅PR2=#268 `2c28990`(A#3·A#4·A#5·A#6·A#7·A#14·A#16) · ✅PR4=#269 `457a864`(B#3) · ✅PR1=#270 `edc0933`(A#1·A#8) · ✅PR6=#271 `acf45d5`(A#9~A#13·C#2·C#4 각주·D#4·E#1) · ✅A#2=#272 `fe6b745`(렌트 무제한 조회 차단). **잔여 0 — 배치 7 완전 종결.**)

## 최종 통합 검증 (머지 후 main, 2026-07-17)
- typecheck 0 · lint 0 · test:unit **743**(87파일, 배치 시작 709 대비 +34) · test:server **553**(+1) · build ✓ · knip **unused export 7·type 9 = 배치 전 baseline 동일(delta 0)** · calc-format.ts 삭제·E#1 dead CSS 제거는 byte-identical 증명 동반.
- 실행 방식: 이행 6PR 전부 subagent-driven(구현자별 RED→GREEN 실관찰 의무) + 오케스트레이터 diff 리뷰 → 검증 → squash 머지. 파일 겹치는 PR은 순차(PR2→PR1→PR6), 안 겹치는 PR은 워크트리 병렬(PR5·PR4).

**범위**: 배치 6(#251까지 감사 + 실행 산물 #252~#257) 이후 미감사 구간 = **#258·#259·#260·#261(병행 세션)·#262·#263·#264·#265 + main 직접 polish `513e417`**. 커밋 `7a45de2..513e417`, 코드 109파일(+6,775/−1,047, ref/ 제외 — 브랜드 로고 PNG 33종 포함).
**방법**: 5앵글 병렬 감사(A 계산기 모달 #262 · B 픽커 통일 #263 · C 패리티 4건+조건 복사 #264/#261 · D quote-fields SSOT #265+서버 전체 · E 소형 4건+크로스커팅·기준선) → 후보 취합 → 전건 적대 검증 → CONFIRMED/ADJUSTED/REFUTED → PR 분할 이행.
**참고**: 브리프의 "같이 소진: 배치 6 잔여 PR3" 문구는 stale — PR3=#256·B#2=#257·A#2=#258로 배치 6 plan에 전량 완료 박제 확인(2026-07-17 실측).

## 기준선 실측 (E — 2026-07-17)
- `bun run typecheck` **0 errors** · `bun run lint` **0 problems** · `bun run test:unit` **709 pass/0 fail**(83 files) · knip unused export 7·type 9 = **delta 0**(16항목 전건 `git grep` 참조 수 7a45de2↔HEAD 대조 동수 — 전부 기존재).
- E 크로스커팅 clean 실측: Safari select 위반 0(신규 select 3곳 전부 bindSelect/uncontrolled) · 서버→클라 import 신규는 `solution.ts`→`solution-quote` 상수뿐(허용 목록) · Workers fetch 메서드 호출 0 · public write 0 · 신규 쓰기 라우트 0(dealer 게이트 확인 불요) · 신규 테스트 실 DB 접촉 0(픽스처 registry 대상 없음) · index.css @import 말미 append만(재배치 0) · 마이그 0032 crm만·4계층(SQL/schema.ts/zod/클라 타입) 동형.

## 감사 총평 (5앵글 + 적대 검증 4명 완료)
- 후보 **32건 = 상 0 · 중 11 · 하 21**. 최대 발원지는 #262 계산기 모달(16건 — 제프 원본 `~/Documents/TypeScript/dolim-solution` 라인 대조로 "이식 드리프트 vs 원형 상속" 구분 수행, 중급 7건 중 CRM 신규 결함은 A#4 Esc 하나·나머지는 원형 상속이되 CRM 화면에서 재현 가능).
- 교차 확인 2건: 조회 fingerprint 누락(A#3 ↔ D 스코프 밖 관찰 독립 일치) · CM/AG 입력 의미론 드리프트(A#8 ↔ D 관찰). 감사관 견해 충돌 1건: 계산기 할인 단위 전환(C#4는 결함 보고 ↔ A는 "원형 보존 의도"로 미보고) — 적대 검증이 판정.
- 신성 규칙 5종(Safari select·import 경계·Workers fetch·public write·dealer 게이트) **전부 준수**(E 전수 + A/B/C/D 각자 재확인). 소형 커밋 4건(#258·#259·#260·`513e417`) 정합성 결함 0. #261↔#264 병행 PR 간 필드 누락 없음(복사 루프에 CM/AG 포함 실측). 워크벤치 uncontrolled DOM 추출 계약(data-*·리마운트 키·위임 핸들러) 전수 보존 실증(D). 마이그 0032 crm만·4계층 동형·실 DB 적용 실측.

### 감사 후보 인벤토리 + 적대 검증 판정 (2026-07-17 확정)
| id | [급] 제목 | 판정 | 검증 요지 |
|---|---|---|---|
| A#1 | [중] 금융사 전사 실패(에러성)가 무사유 "조회 결과가 없습니다"로 은닉(error 필드가 `toResults`에서 탈락·소비처 0) | **CONFIRMED** | #241 랭킹 모달 failureNote fail-loud 박제 원칙과 정면 충돌. 훅 유닛은 error **저장**만 잠금(렌더 소비 무테스트). 옵션/컬러 fetch 실패도 '정보 미제공'으로 오표기 |
| A#2 | [중] 렌트+약정거리 '무제한' → parseInt NaN → JSON null → 릴레이 zod 전사 400 → 전멸 | ADJUSTED | 제프 원형 byte-동일 상속(제프 prod에도 동일 버그·스키마에 unlimited 표현 자체 부재). 빨간 경고문이 부분 신호라 "완전 무사유"는 과대. 수정 = 필드 **생략**(파트너 optional)이되 "생략=무제한" 의미 제프 확인 선행 |
| A#3 | [중] 조회 fingerprint에 activeTab·releaseMethod·maintenanceGrade 누락 → 리스 결과가 렌트 탭 아래 "조회 완료" 오표시 | ADJUSTED | 제프 원형 동일 누락(상속 — CRM 신규 아님). payload-영향 누락 필드는 정확히 그 3개가 전부. D 앵글 독립 교차 확인 |
| A#4 | [중] 픽커 열린 상태 Esc = 계산기 모달 전체 닫힘(입력 전소실) | **CONFIRMED** | 픽커 5종 keydown 0 실측·**CRM 셸 신규 갭**(제프는 페이지라 Esc 없음). spec D1 "입력 유실 방지" 근거와 모순. 구현 주의: 모달 리스너 선등록이라 픽커 쪽 캡처 단계 or `.jeff-ui` DOM 프로브 |
| A#5 | [중→중하] 초기화 후 재조회 불가 + "조회 완료"↔빈 결과 화면 모순 | ADJUSTED | dead-end는 **기본 조건으로 조회한 경우에만**(조건 변경 시 즉시 회복). 상태 모순 자체는 실재. 제프 상속 |
| A#6 | [중] 조회 중 초기화 시 in-flight 응답이 리셋을 덮고 결과 부활(취소 수단 0) | **CONFIRMED** | 랭킹 모달 `cancelled` 선례와 대조되는 실경합. [초기화] 로딩 중 활성 실측. 유일한 경합 창 = 초기화(조회 버튼은 disabled) |
| A#7 | [중] 옵션 전체 해제 [적용] 시 옵션 금액 잔존 → "선택 없음"↔구 합산액 모순 + 차량가·취득세·payload 오염 | **CONFIRMED** | "수동 입력 유지" 주석은 수동 타이핑 보존용 — 해제 직전 자동 합산액 잔존은 미박제. 수정은 effect가 아닌 **픽커 onApply 지점**(빈 세트 && 직전 비어있지 않음 → '0') |
| A#8 | [하] CM/AG % '.'→NaN→8사 400 은닉·%>100 무캡 — 워크벤치 fail-loud와 비대칭 | ADJUSTED | NaN 경로는 **CM/AG %에만**(선수금/보증금은 onlyDigits+`\|\|0`라 무캡만). '1.2.3'은 NaN 아닌 1.2 무음 절단. 수정 = 워크벤치 `parsePercentInput` 재사용 |
| A#9 | [하] price≤0 트림 선택 시 직전 트림 가격 잔존 | CONFIRMED | psql 재현(id 2682·2765, mc_code 보유·출시예정·선택 가능). 완화: 기본가격 input 상시 노출·첫 선택은 릴레이 min(1) 400 |
| A#10 | [하] quote-types.ts 어휘 인라인 재선언 + "CRM SSOT 없다" 주석 거짓 | CONFIRMED | 같은 커밋(2e7532d)이 SSOT 상수와 그 주석을 동시 도입. 같은 파일이 LeaseTerm은 typeof 파생 기사용 — 자기모순. typeof 파생 2줄 교체 |
| A#11 | [하] woori 금리·라운딩·총비용 공식 복제(solution-ranking 미재사용) | ADJUSTED | 카운트 정밀화(금리 2벌·총비용 2벌·라운딩 3사이트). `solutionMonthlyDisplay` **drop-in** 가능(calc-format.ts 통째 삭제 가능). lender-meta 박제는 sort/stats 한정이라 방패 아님 |
| A#12 | [하] 모달 오픈당 브랜드 목록 fetch 정확히 2회(훅 자동+모달 명시) | CONFIRMED | 제프도 동일 이중 호출(상속·박제 아님). 모달 측 effect 제거 한 줄 |
| A#13 | [하] types.ts 헤더 주석 4항목 중 2항목이 실전송 코드와 모순 | CONFIRMED | 제프 스테일 주석 byte-복사(제프 HEAD도 렌트 전송). 한 줄 정정 |
| A#14 | [하] 재조회 후 사라진 금융사 선택 유령 잔존(3개 상한·"견적서 보기 (N)" 오염) | CONFIRMED | 유령 해제 경로 부재 실증. 견적서 보기 준비 중이라 실피해 낮음 |
| A#15 | [하] buildPayload·취득세 공식·residual 매핑·entry 조립 유닛 0건 | ADJUSTED | "관례 위반"은 과함(플랜이 훅 스코프 테스트 박제·스모크 보완) → "1:1 이식의 알려진 부산물 + 후속 추출 후보"로 재프레임. 순수 대응물은 전부 테스트 보유라 사각 선명(A#2·A#8이 이 구역 산물) |
| A#16 | [하] selectBrand/selectModel 취소 가드 부재 race(계산기) | CONFIRMED | useTrimExtras·제프 effect는 cancelled 보유 — 액션 함수만 부재. 창 좁음 적정 |
| B#1 | [중] 옵션 다이얼로그 로컬 편집이 부모 재렌더에 리셋 — 체크박스 글리프 클릭이 결정적 트리거 | **CONFIRMED** | **실제 컴포넌트 브라우저 하네스 재현**: 글리프 클릭 → panel-input 발화 → `[t,f,f]→[f,f,f]`. 안정 Set 대조군은 동일 압력에 무사 = 원인은 `new Set(...)` prop identity(WorkbenchVehiclePickers:212)×effect deps `[open, selectedIds]` |
| B#2 | [중] includes 자동 선택 계약(스펙 확정+구 테스트 잠금) 무박제 소실 — 저장 옵션 구성·총액 값 드리프트 | **CONFIRMED** | includes 374행 실존·구 코드 실발동 확인·신 주석 "다이얼로그가 자체 처리"는 거짓 서술(무인지 소실 방증). **방향은 제품 판단**(강제 복원 vs 캡션-only 정식 채택+스펙 개정) — 기록 없는 현 상태가 결함 |
| B#3 | [중] 워크벤치 unlayered 후손 CSS가 픽커 다이얼로그 오염 | **CONFIRMED** | 실 빌드 CSS 레이어 판정(kim=unlayered vs 유틸=@layer utilities) + 실 조상 체인 computed 실측: h4 네이비 바 32px(워크벤치 전용)·체크박스 15×25 왜곡·검색창 우정렬/inset shadow(**양 컨텍스트** — #265 kim-jeff-quote-body 채택 경유 계산기에도 확산). 스모크 "15px" 기록은 폭 측정이라 양립 |
| B#4 | [하] 픽커 fetch 실패 전 경로 침묵 — 빈 목록 고착·재fetch 경로 0·구 errored 테스트 대체 없이 삭제 | CONFIRMED | :65 주석("행 클릭으로 처음부터 선택 가능")은 복원 실패 시 거짓. apiFetch GET 3회 재시도가 빈도만 완화 |
| B#5 | [하] selectBrand/selectModel 늦은 응답이 다이얼로그 강제 오픈 | CONFIRMED | 재선택 없이도 발현(fetch 지연 중 브랜드 다이얼로그 재오픈 → 응답 도착 순간 강탈 교체). 자동 오픈 귀결은 #263 신규. 계산기도 사촌 race 보유(A#16과 대칭) |
| C#1 | [하] 조건 복사 후 대상 카드 stale 솔루션 스냅샷 잔존 | ADJUSTED | 복사 고유 아님 — 스냅샷 무효화는 **조건 편집 전반에 원래 부재**(스냅샷=provenance 기록 의미론·#261 "복사 후 재조회가 채운다" 박제). 폴리시 질문으로 격하(기록만) |
| C#2 | [하] 조건 복사가 in-flight 조회와 미가드 | ADJUSTED | in-flight 중 전 조건 input·저장 버튼도 미가드 — 복사 버튼 disable은 **부분 개선**으로 명시하고 이행 |
| C#3 | [하] residue 테스트 buildCardDom에 cm/ag 필드 미동기 — 복사 루프 null-가드 탓 회귀가 무음 no-op | CONFIRMED | #264가 "조건 복사 포함"을 계약으로 명시한 만큼 잠금 부재는 정당한 갭. 픽스처 2필드+단언 2줄 |
| C#4 | [하] 계산기 할인 단위 전환 의미론 3벌 병존 | ADJUSTED | 기본 할인 값-유지·onlyDigits = **제프 원형 byte-일치(A 우세 — 변경 비권장)**. 추가 행 reset-0만 제프와도 워크벤치와도 다른 **제3 선택 미박제**(C 성립) → 코드 각주 박제가 적정 |
| C#5 | [하] 12개월 세그먼트 렌트 탭 노출(파트너 지원 미확인) | **REFUTED** | 파트너 zod가 12를 productType 무관 수용 실측 + 제프 스스로 12개월 양 탭 UI 채택·배포(제프 #53 "CRM 계산기 요구 3종") + 최악도 fail-loud |
| C#6 | [하] 저장 경로 >100% CM/AG 무음 드롭 | **REFUTED** | >100→null과 조회 fail-loud가 #264 커밋 한 본문에 쌍으로 박제된 의도적 이중 설계(금리 선례 미러). 원 미리보기 0원 표시로 완전 무음도 아님. UX 개선 제안은 제품 판단 분류 |
| D#1 | [하] kim-jeff-quote-body가 계산기 전용 슬롯 폰트 웨이트 오버라이드 | **REFUTED** | 기계 증명 — 제프 루트 `[&_button]:font-medium`(0,1,1)이 같은 utilities 레이어의 font-semibold(0,1,0)를 원본에서부터 이김. 600은 어디서도 렌더된 적 없고 kim CSS는 동치 500 = 계산값 변화 0 |
| D#2 | [중] 마이그 0032 cm/ag 2필드 서버 왕복(zod→insert→read) 테스트 부재 | **CONFIRMED** | src 테스트 cm/ag 0건 실측. 0024·0031 선례(필드 배치마다 왕복 테스트)와 비대칭. 두 필드 동형(string\|null)이라 교차 배선 회귀는 typecheck·server 552 전부 무감. 서로 다른 값 왕복 1본 처방 |
| D#3 | [하] 취득세 라벨 zip index 암묵 결합 가드 0 | **REFUTED** | "가드 0" 거짓 — QuoteFields.test.tsx:208-211이 라벨 튜플을 정확값·순서·길이로 잠금(tripwire 실존) + 어휘 동결 |
| D#4 | [하] ValueSelect className이 selectProps spread에 무음 대체 footgun | CONFIRMED | 소비처 2곳 미전달 = 발현 0. Omit 또는 병합 한 줄 — 우선순위 최저 |
| E#1 | [하] `.vertical-separator` 전역 dead CSS 2규칙 잔존(controls.css:55·dashboard.css:181) | CONFIRMED | #258 커밋 스스로 "전 앱 렌더 0건" 기록하고도 headbar 스코프 조각만 제거. 전 앱 참조 0건 재실측. #258 byte-identical 증명 방식 재사용 |

---

## 실행 후보 (CONFIRMED/ADJUSTED) — PR 그룹 (✅ 전량 이행)

이행 시 소속 조정: A#3·A#16은 계산기 파일이라 PR2로, B#2는 결정(구 계약 복원)이 나서 PR3에 편입. A#2는 제프 확인 선행이라 이번 배치에서 코드 미변경(§제품 결정 2).

### ✅ PR1 = #270 — 계산기 실패 표면화 + % 입력 위생 (A#1 + A#8, 조건부 A#2)
- **A#1[중]**: `toResults`에 error 통과 + 결과 전멸 && error≥1건이면 사유 1줄 표면화(#241 랭킹 모달 failureNote 미러 + console.warn) + 옵션/컬러 placeholder에 error 분기("불러오지 못했습니다"). A#2·A#8의 은닉 경로도 이걸로 최소한 사유가 보이게 된다.
- **A#8[하]**: CM/AG % 입력을 워크벤치 `parsePercentInput` 재사용으로 — NaN('.')·무캡(>100)·무음 절단('1.2.3') 한 번에 해소.
- **A#2[중, 조건부]**: unlimited 시 `annualMileageKm` **생략**(percent-0 생략 가드 선례 패턴) — 단 "생략=무제한" 의미인지 **제프 확인 선행**. 확인 전엔 A#1 사유 표면화만으로도 "왜 전멸인지"는 보인다. 확인 후 후속 커밋.

### ✅ PR2 = #268 — 계산기 상태 라이프사이클 (A#4 + A#6 + A#7 + A#5 + A#14 + A#3 + A#16)
- **A#4[중·CRM 신규]**: 픽커 열림 시 모달 Esc 무시(`.jeff-ui` DOM 프로브 — 스크롤 잠금 `:has` 셀렉터와 같은 판별) 또는 픽커 캡처 단계 Esc 자체 소비.
- **A#6[중]**: useMultiQuote에 세대 카운터 — reset/calculateAll마다 증가, stale 응답 폐기(랭킹 모달 cancelled 선례 부류).
- **A#7[중]**: 옵션 픽커 onApply 지점에서 "빈 세트 적용 && 직전 세트 비어있지 않음 → optionPrice '0'"(수동 입력 경로 보존).
- **A#5[중하]**: resetAll 시 카드 로컬 상태 동반 리셋(리셋 epoch를 key로 태워 카드 리마운트 — 신규 상태 채널 0).
- **A#14[하]**: 재조회 시 해당 시나리오 선택 클리어(또는 생존 금융사로 필터).
- 전부 제프 원형 상속(A#4 제외) — 수정 = 제프 대비 의도 이탈, PR 본문에 기록.

### ✅ PR3 = #267 — 워크벤치 픽커 정합 (B#1 + B#2 복원 + B#4 + B#5)
- **B#1[중]**: `useMemo` Set 안정화 + 다이얼로그 시드 effect를 open 전이 시 1회로(제프 원형 의미론) — 부모 재렌더 리셋 케이스 테스트 동반.
- **B#4[하]**: errored 상태 복원 + 실패 표면화 + 트리거 클릭 시 빈 목록이면 재fetch + 삭제된 에러 테스트 복원.
- **B#5[하]**: selectBrand/selectModel 요청 세대 토큰 — 최신 선택의 응답만 반영·오픈.
- **A#3[중]**: fingerprint에 activeTab(+렌트 시 deliveryType·maintenanceGrade) 편입 — "payload에 실리는 키 = fingerprint 키" 원칙. (파일은 계산기지만 B#5·A#16과 race 계열 묶음도 가능 — 분할은 이행 시 판단.)
- **A#16[하]**: useMasterCatalog selectBrand/selectModel에도 동일 세대 가드(B#5와 대칭 — 같은 훅 계열 한 번에).

### ✅ PR4 = #269 — CSS 스코프 가드 (B#3)
- kim 후손 규칙(`.kim-jeff-quote-body input`·`.kim-jeff-section h4` 등)에 `:where(:not(.jeff-ui *))` 가드(theme.css/dashboard.css 선례 미러 — 특이성 불변) 또는 jeff-ui 보호 규칙 명시. **계산값 증명 관례(#207/#258/#263) 동반 필수** — 다이얼로그 안(원복)과 밖(불변) 양방향.

### ✅ PR5 = #266 — 테스트 보강 (D#2 + C#3)
- **D#2[중]**: customers.test.ts 확장 필드 왕복에 `cmFeePercent: "1.5", agFeePercent: "2"`(서로 다른 값 — 교차 배선 검출) + 단언. 이번 배치 유일한 "무음 데이터 오염 방지선 부재".
- **C#3[하]**: residue 테스트 buildCardDom에 cm/ag 2필드 + 복사·추출 단언.

### ✅ PR6 = #271 — 소형 정비 일괄 (A#9 + A#10 + A#11 + A#12 + A#13 + C#2 + C#4 각주 + D#4 + E#1)
- A#9 price≤0 트림 시 basePrice 리셋 · A#10 typeof 파생 2줄+주석 정정 · A#11 `solutionMonthlyDisplay` drop-in(calc-format.ts 삭제)+woori 금리 헬퍼 공유 · A#12 모달 측 loadBrands 중복 호출 제거 · A#13 주석 정정 · C#2 복사 버튼 `solutionLoadingId` disable 한 줄(부분 개선 명시) · C#4 코드 각주 박제(기본 할인 값-유지 = 제프 원형 보존 의도·추가 행 reset-0 근거) · D#4 ValueSelect className Omit/병합 · E#1 dead CSS 2규칙 제거(byte-identical 증명).

---

## 제품 결정 필요
1. **B#2[중] includes 자동 선택 소실**: ①구 계약 복원(다이얼로그 toggle에 includes 한 단계 자동 ON 이식) vs ②캡션-only를 새 계약으로 정식 채택(스펙 2026-06-15 개정 + 박제 + 주석 정정). 계산기(제프)는 원래 미강제라 ②가 "계산기와 UX 통일"과 정합하지만, CRM 저장 견적의 옵션 총액 계약이 걸려 있어 **유슨생(필요시 이사님) 결정 선행**. 어느 쪽이든 무기록 현 상태는 결함.
2. ~~**A#2 잔여**: "annualMileageKm 생략 = 무제한" 의미인지 제프 확인~~ → **✅ 해소(#272, 2026-07-17)**: 제프 저장소 실측으로 확인 불요 확정 — MG 렌트 엔진이 `annualMileageKm ?? 20_000`이라 **생략 = 기본 2만km 무음 오계산**(생략안 기각). 수정 = `distanceGuardReason`으로 렌트 무제한 선택 시 조회 차단+사유 표면화(A#8 blockReason 채널 공유, 옵션은 제프 원형 유지). 파트너가 무제한을 계약에 편입하면 가드만 제거.

### 제프 동향 박제 (2026-07-17 실측 — 제프 07-15~17 커밋 21개 감사)
- **판매사(딜러) 일반화(제프 #52·#56~#60)**: `GET /api/external/catalog/dealers?lenderCode&brand`(X-API-Key) 신설·**prod 가동 실측**(BNK 3딜러·우리카드 N·신한 빈 목록 — 신한은 파서 미저장 의도). 응답 shape 통일 `{dealerName, baseIrrRate}`(baseIrrRate 의미는 사별 상이 — 제프 리졸버 주석 참조). calculate 스키마에 canonical `dealerName` 신설, `bnkDealerName`은 "CRM 실사용 — 영구 수용(제거 금지)" 박제. 딜러 리졸버 3사(BNK·우리·메리츠). → **#262 follow-up(BNK 딜러 엔드포인트) 해소+3사 확장 언블록 — 계산기 판매사 select(D2 v1 숨김) 실동작화는 제품 결정 대기**.
- **lenderCode enum 강제(제프 #47)**: 미지원 코드 400(과거 MG 조용 폴백). CRM 8코드 ↔ 제프 enum 8코드 정확 일치 실측 — 영향 0.
- **계산 실버그 픽스(제프 #61·#64)**: 메리츠 워크북 productType 스코프 + MG 월납 체인 2종(선납 base IRR·소유구분 부가세) — **새 조회부터 메리츠·MG 계산값 변화**(정정 방향). CRM 스냅샷은 provenance 의미론이라 과거 값 유지 = 의도, CRM 테스트는 픽스처 기반이라 무영향.
- **UI 양방향 수렴(제프 #53~#55·#65)**: CRM 요구 3종(할인 라인·취득세 직접입력·12개월) 채택 + CRM quote-fields(kim-jeff) 디자인 역이식. **향후 "제프 원본 1:1 diff" 방법론 사용 시 원본이 CRM 디자인을 역수입한 상태임을 유의.**
- 미취급 문구("취급하지 않습니다" 계열) 불변 — CRM `NOT_AVAILABLE` 패턴 유효.

## 기록만 / 후속 리스크 (이번 배치 조치 불필요)
- **C#1** 스냅샷 무효화 정책 — **✅ 결정·종결(유슨생, 2026-07-17): 현행 유지 + 박제.** 조회 후 조건 편집 시 스냅샷/월납입을 무효화하지 않는다 — 워크벤치는 본래 수기 견적 도구(미취급 금융사 수기 작성 경로와 일관)라 상담사 수기 조정 자유를 보존하고, 스냅샷은 "마지막 조회가 어느 금융사/워크북 기준이었나"의 provenance 기록(정합 보증 아님)으로 확정. 재론 트리거 = 혼합 저장으로 인한 실사용 혼란 리포트.
- **A#15** buildPayload·취득세 공식 순수 모듈 추출+TDD — 1:1 이식의 알려진 부산물. #264가 워크벤치 몫을 solution-quote.ts로 순수화한 선례가 있어 후속 추출 고가치(PR1·2를 이행하면 자연히 일부 추출될 수 있음 — 이행 시 판단).
- **제프 공유 가치**(A#2·A#3은 제프 prod에도 살아 있는 버그): 수정 확정 시 제프 팀에 항목 공유(unlimited 전멸·fingerprint 누락 + 참고로 A#5~A#7·A#14도 원형 보유).
- **C#6 파생 UX 제안**(저장 시 >100% 경고 토스트)은 제품 판단 — 요구 생기면 별도.

## 🚫 기각 박제 (재제안 금지 — 반박 근거)
| 항목 | 기각 사유 |
|---|---|
| **C#5** 12개월 렌트 탭 노출 | REFUTED — 파트너 zod가 `leaseTermMonths` 12를 productType 무관 수용(dolim-solution shared/contracts 실측) + 제프 스스로 12개월을 양 탭 공용 UI로 채택·배포(제프 #53 "CRM 계산기 요구 3종") + 최악도 fail-loud 에러 표면화. 잔여는 MG 워크북 요율 행 존재 여부라는 데이터 질문일 뿐 |
| **C#6** 저장 경로 >100% 무음 드롭 | REFUTED — >100→null(parseInterestRate 재사용)과 조회 fail-loud가 #264 커밋 본문에 쌍으로 박제된 의도적 이중 설계(금리 선례 미러). 훅 주석("파생 경로는 토스트 없이 오염만 차단")도 무음 방침 명시. 원 미리보기 0원 표시로 완전 무음 아님 |
| **D#1** kim-jeff-quote-body 폰트 웨이트 오버라이드 | REFUTED(기계 증명) — 제프 루트 `[&_button]:font-medium`(특이성 0,1,1)이 같은 @layer utilities의 font-semibold(0,1,0)를 **원본에서부터** 이겨 600은 어디서도 렌더된 적 없음. kim CSS의 unlayered 500은 동치라 계산값 변화 0. "현행 look" 모순 불성립 |
| **D#3** 취득세 라벨 zip 가드 0 | REFUTED — QuoteFields.test.tsx:208-211이 `ACQUISITION_TAX_MODE_LABELS` 튜플을 정확값·순서·길이로 잠그는 tripwire 실존 + 4모드 어휘 사실상 동결. zip 구조 자체는 meta 주석("모드 value는 화면별 상태 계약이라 각자 zip")에 박제됨 |

## 실행 우선순위 (유슨생 판단 대상)
제안(권고 순):
1. **PR3**(B#1 실측 재현된 입력 소실 + 픽커 정합 묶음) — 상담사 실사용 접점에서 가장 아픈 결함.
2. **PR2**(계산기 상태 라이프사이클 — A#4 입력 전소실 포함) + **PR1**(실패 표면화 — #241 원칙 정합).
3. **PR5**(테스트 보강 — D#2 데이터 오염 방지선) — 저비용 선행 가능.
4. **PR4**(CSS 스코프 가드 — 증명 비용 높음) · **PR6**(소형 일괄).
5. **B#2**는 제품 결정 후 별도 슬라이스(결정에 따라 코드량 상이).
