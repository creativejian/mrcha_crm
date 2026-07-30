# MC 마스터 변경 승인 워크플로 — PR 2 (관리자 대기열 UI) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** admin이 mc-master 안팎에서 팀장의 변경 요청을 보고(배지·대기열 팝오버·전→후 diff) 승인/반려하며, 항목 클릭으로 대상 트림에 착지 점프한다.

**Architecture:** 서버는 소폭(점프 좌표 3필드 동봉 + parsed.data 일원화 + kind SSOT를 클라 순수 lib로 이동). 클라는 새 팝오버 컴포넌트(부품 재사용: popoverPosFromRect·usePopoverDismiss) + lib 훅 + 사이드바 admin 메뉴 신설·배지.

**Spec:** `ref/specs/2026-07-30-crm-catalog-change-approval-design.md` §7.2·§7.4·§7.5 / PR 1 잔여 합의(parsed.data는 PR 2 diff와 묶음)

**선행 사실(탐색 실측, 2026-07-30):**
- MCMasterPage 헤더는 `panel-head` 안 `inTrimView` 삼항 — 모델 목록 분기의 `MyProposalTrimsButton` 자리(:413)가 admin 버튼 선례. `canEdit = roleTab === "최고관리자"`.
- ProposalTrimsPopover는 딜러 행 구조에 강결합 → **새 컴포넌트**. 재사용 부품 = `popoverPosFromRect`/`PopoverPos`(export 됨)·`usePopoverDismiss`.
- 착지 점프 선례 = `navigate(\`${mcMasterPath(brandId, modelId)}&hl=${trimId}\`)` (brand 쿼리 필수 — 없으면 정규화 effect가 hl을 지움). **서버 응답에 brandId/modelId/trimId가 없어 동봉 필요.**
- admin 사이드바에 mc-master 메뉴 없음(딜러 전용) → **관리 구역 신설 결정**(유슨생 위임, 2026-07-30). 배지 마크업 SSOT = `<span className="nav-count num">{n}</span>`.
- 배지 갱신 선례 = 60s setInterval + window focus 재조회(dealer-roster 근거 주석). Realtime 구독은 과함.
- 상대시각 = `waitingLabel(iso, now, "전")`(`client/src/lib/chat.ts:111`) 재사용 — ISO 직수용·"전" 축 기존재.
- 요청자 이름 = `client/src/lib/staff.ts`의 `useStaffDirectory` + `staffNameOf` (+ `?? "알 수 없음"` 폴백 필수).
- MC 마스터 실패 관례 = `window.alert`/인라인 에러(토스트 없음). lint 함정 3종: effect 본문 setState 금지·렌더 중 ref 갱신 금지·같은 파일 전용 export 금지.

---

### Task 1: kind 어휘 SSOT를 클라 순수 lib로 이동 (+ 한글 라벨)

**Files:**
- Create: `client/src/lib/catalog-change-kinds.ts`
- Modify: `src/db/schema.ts` (CHANGE_REQUEST_KINDS 정의 제거 → import·re-export), `AGENTS.md` (서버→클라 순수 모듈 허용 목록 한 줄)

- [ ] **Step 1: 새 lib 작성** — `client/src/lib/catalog-change-kinds.ts`

```ts
// MC 마스터 변경 요청 kind 어휘(SSOT — discount-adoption.ts와 동형). 서버(src/db/schema.ts —
// DB CHECK 파생·레지스트리 키)와 클라(대기열 라벨)가 이 배열 하나를 본다. 부작용 0 순수 모듈이라
// 서버→클라 import 경계(AGENTS.md)에 허용된다. 9번째 kind 추가 시 여기 + 라벨 + 서버 레지스트리.
export const CHANGE_REQUEST_KINDS = [
  "model.create", "model.update",
  "trim.create", "trim.update",
  "option.create", "option.update",
  "trim.no-option.set", "trim.no-option.unset",
] as const;
export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];

export const CHANGE_KIND_LABELS: Record<ChangeRequestKind, string> = {
  "model.create": "모델 추가",
  "model.update": "모델 수정",
  "trim.create": "트림 추가",
  "trim.update": "트림 수정",
  "option.create": "옵션 추가",
  "option.update": "옵션 수정",
  "trim.no-option.set": "무옵션 확정",
  "trim.no-option.unset": "무옵션 해제",
};

// diff 필드 한글 라벨 — 트림/모델/옵션 payload 키 전체(스냅샷 selector와 같은 어휘).
// 할인 3필드는 DISCOUNT_FIELD_LABELS(discount-adoption.ts)와 표기를 맞춘다.
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  trimName: "트림명", price: "가격", modelYear: "연식", fuelType: "연료",
  driveSystem: "구동", displacementCc: "배기량", transmissionType: "변속기",
  bodyStyle: "차체", seatingCapacity: "승차정원", status: "상태",
  financialDiscountAmount: "자사할인", partnerDiscountAmount: "제휴할인", cashDiscountAmount: "타사할인",
  category: "카테고리", name: "이름", type: "종류", brandId: "브랜드", modelId: "모델", trimId: "트림",
};
```

- [ ] **Step 2: `src/db/schema.ts` 전환** — 기존 `CHANGE_REQUEST_KINDS` 배열·`ChangeRequestKind` 타입 정의를 제거하고:

```ts
import { CHANGE_REQUEST_KINDS } from "../../client/src/lib/catalog-change-kinds";
// (파일 상단 import 구역 — 기존 client/src/data/* import 관례와 같은 축)
export { CHANGE_REQUEST_KINDS };
export type { ChangeRequestKind } from "../../client/src/lib/catalog-change-kinds";
```

기존 소비처(`change-request-kinds.ts`의 `import { type ChangeRequestKind } from "../../db/schema"`)는 re-export 덕에 무변경. kind CHECK의 `sql.raw(...)` 파생도 그대로 동작(같은 배열).

- [ ] **Step 3: AGENTS.md 허용 목록 한 줄** — "서버→클라 순수 모듈 import 경계" 항목의 허용 lib 나열에 `catalog-change-kinds.ts — 변경 요청 kind·라벨 SSOT, 2026-07-30` 추가.

- [ ] **Step 4: 검증 후 커밋** — `bun run typecheck && bun run lint && bun run knip`(라벨 2맵은 이 시점 미소비 — Task 3·4에서 해소, 등록 금지·보고만) + 실 DB 스위트 1개(`EMBED_ON_WRITE=off PUSH_NOTIFY=off AI_HINT_ON_WRITE=off bun test --env-file=.env.local src/routes/catalog/change-request-kinds.test.ts`) → commit `refactor(crm): 변경 요청 kind SSOT를 클라 순수 lib로 이동 + 한글 라벨`

### Task 2: 서버 — 점프 좌표 동봉 + parsed.data 일원화

**Files:**
- Modify: `src/db/queries/change-requests.ts` (labelTargets), `src/routes/catalog/change-request-kinds.ts` (submit·approve), 테스트 2파일

- [ ] **Step 1: `labelTargets`가 좌표 3필드를 함께 합성** — `ChangeRequestListItem`에 `targetBrandId: number | null; targetModelId: number | null; targetTrimId: number | null` 추가. models 조회에 `brandId: modelsInCatalog.brandId` 추가. 합성 규칙(라벨과 같은 분기에서):
  - model 대상/`model.create`: modelId = targetId(또는 create는 null), brandId = modelById(또는 payload.brandId)
  - trim 대상: trimId = targetId, modelId = trimById.modelId, brandId = 그 모델의 brandId / `trim.create`: modelId = payload.modelId
  - option 대상: trimId = optionById.trimId → 모델·브랜드 체인 / `option.create`: trimId = payload.trimId
  - 대상 소실 시 해당 필드 null (클라는 null이면 점프 버튼 비활성)
- [ ] **Step 2: parsed.data 일원화** — `submitChangeRequest`: `upsertPendingRequest`에 `payload` 대신 **`def.bodySchema.parse(payload)` 결과**를 저장(422 방어는 라우트 zValidator가 이미 함 — 여기 parse는 default 적용 목적. snapshot은 파싱 결과 기준으로 build). `approveChangeRequest`: `def.buildSnapshot`·`def.execute`에 `claimed.payload` 대신 `parsed.data` 전달(execute 내부 재파싱은 방어선으로 유지). 근거 주석: 저장 payload = 실행될 값 = diff 화면이 보여줄 값 (PR 1 리뷰 합의 #6).
- [ ] **Step 3: 테스트 갱신** — `src/db/queries/change-requests.test.ts`의 라벨 케이스에 좌표 단언 추가(`targetModelId === modelId` 등) · `src/routes/catalog/change-request-kinds.test.ts`에 default 일관 케이스 1건(`model.create`를 category 생략 payload로 적재 → 저장 행 payload에 `category: null` 채워짐 단언).
- [ ] **Step 4: 검증 후 커밋** — typecheck·lint + 실 DB 3스위트(queries/change-requests·kinds·routes/catalog.change-requests) → commit `feat(crm): 대기열 응답에 점프 좌표 동봉 + 저장 payload를 파싱 출력으로 일원화`

### Task 3: 클라 lib — fetch 훅 + diff 빌더(순수)

**Files:**
- Create: `client/src/lib/catalog-change-requests.ts`
- Test: `client/src/lib/catalog-change-requests.test.ts` (diff 빌더 순수 유닛 — test:unit)

- [ ] **Step 1: 타입·fetch·훅** (`discount-proposals.ts` 대칭 — effect setState 금지·alive 가드·실패 무소음, 액션 실패는 throw):

```ts
import { getJson, sendJson, sendVoid } from "./http";
import { CHANGE_FIELD_LABELS, CHANGE_KIND_LABELS, type ChangeRequestKind } from "./catalog-change-kinds";

export type ChangeRequestItem = {
  id: string; kind: ChangeRequestKind; targetType: string; targetId: number | null;
  payload: Record<string, unknown>; snapshot: Record<string, unknown> | null;
  status: string; requestedBy: string; rejectReason: string | null;
  createdAt: string; targetLabel: string;
  targetBrandId: number | null; targetModelId: number | null; targetTrimId: number | null;
};

export function useChangeRequestQueue(enabled: boolean): {
  rows: ChangeRequestItem[] | null; failed: boolean; reload: () => void;
  approve: (id: string) => Promise<void>; reject: (id: string, reason: string) => Promise<void>;
}
// 구현: fetch = getJson<ChangeRequestItem[]>("/api/catalog/change-requests?status=pending");
// approve = sendJson(`/api/catalog/change-requests/${id}/approve`, "POST") 후 전체 재조회 — 실패는 throw(호출부 표시);
// reject = sendJson(..., "POST", { reason }) 후 재조회 — 실패 throw. reload는 수동 재조회(배지 클릭 시 신선도).
```

- [ ] **Step 2: diff 빌더 순수 함수** (같은 파일 — 서버 스냅샷 규약 §5.1 기준):

```ts
export type ChangeDiffLine = { label: string; before: string | null; after: string };

// update: snapshot(전) vs payload(후) — 키는 payload 기준(스냅샷과 동일 집합, 서버 계약).
// create: 전 없음, payload 나열(부모 id류는 targetLabel이 이미 말하므로 제외). 토글: 한 줄 문구.
export function buildChangeDiff(row: ChangeRequestItem): ChangeDiffLine[]
// 값 표시: null → "—", number → toLocaleString(가격류), 그 외 String. 필드 라벨 = CHANGE_FIELD_LABELS[k] ?? k.
```

- [ ] **Step 3: 유닛 테스트** — trim.update(가격 전→후·null→값) / model.create(나열·brandId 제외) / no-option 2종 문구 / 알 수 없는 키 폴백. `bun run test:unit client/src/lib/catalog-change-requests.test.ts`
- [ ] **Step 4: 검증 후 커밋** — typecheck·lint·format:check(테스트 파일이 클라 글롭 대상) → commit `feat(crm): 대기열 클라 lib — 훅 + 전→후 diff 빌더`

### Task 4: 대기열 팝오버 + MCMasterPage 배선 + 착지 점프

**Files:**
- Create: `client/src/components/ChangeRequestQueue.tsx` (버튼+팝오버 한 파일 — MyProposalTrims.tsx 셸 선례)
- Modify: `client/src/pages/MCMasterPage.tsx` (헤더 두 분기에 버튼), `client/src/styles/vehicle-admin.css` (팝오버·행·diff·에러 스타일 — `va-cr-*` 네이밍)

- [ ] **Step 1: 컴포넌트** — `ChangeRequestQueueButton({ onApplied }: { onApplied: () => void })`:
  - 버튼 라벨 `승인 대기 (N)` — N은 훅 rows.length(로딩 중 캐시 없음 → "승인 대기"만). 0건이면 disabled.
  - 팝오버: `popoverPosFromRect` + `usePopoverDismiss`(반려 입력 중 guard). 행 = 요청자 이름(`staffNameOf(row.requestedBy) ?? "알 수 없음"`, `useStaffDirectory()`로 로드 보장) · `waitingLabel(row.createdAt, new Date(), "전")` · `CHANGE_KIND_LABELS[row.kind]` · `targetLabel` · diff 블록(`buildChangeDiff`) · [승인] [반려] · 행별 에러 라인.
  - 승인: `approve(id)` — 성공 시 `onApplied()`(부모가 reloadTrims 등) · `HttpError` catch → 그 행에 `err.message` 표시(409 드리프트 문구가 서버에서 온다), 목록은 유지(재조회는 승인 성공시에만).
  - 반려: 행 내 인라인 입력 전환(placeholder "반려 사유") → 확인 시 `reject(id, reason)` · 빈 사유는 로컬 차단.
  - 점프: 행의 대상 라벨 클릭 → `row.targetModelId != null && row.targetBrandId != null`이면 `navigate(\`${mcMasterPath(row.targetBrandId, row.targetModelId)}${row.targetTrimId != null ? \`&hl=${row.targetTrimId}\` : ""}\`)` + 팝오버 닫기. 좌표 null이면 클릭 불가(삭제된 대상).
- [ ] **Step 2: MCMasterPage 배선** — 모델 목록 분기(:413 옆)와 트림 뷰 분기(`.va-head-back` 뒤) 둘 다 `{canEdit && <ChangeRequestQueueButton onApplied={() => { reloadModels(); if (modelId) { reloadTrims(); reloadOptionSummary(); } }} />}`. (승인 대상이 현재 화면 밖이면 재방문 시 fetch가 처리 — 캐시는 reloadTrims의 force 축.)
- [ ] **Step 3: CSS** — `va-cr-pop`(fixed·z-index 70·max-width min(720px, 100vw-24px)·내부 스크롤), `va-cr-row`, `va-cr-diff`(전→후 2열), `va-cr-error`(빨간 인라인), `va-cr-reject-input`. dashboard.css의 `org-dealer-*`를 복제하지 말고 vehicle-admin.css에 독립 신설(도메인 소유 분리).
- [ ] **Step 4: 수동 확인 + 커밋** — admin magiclink로 로컬 실기 1회(버튼 노출·팝오버·diff — 승인은 실 카탈로그를 바꾸니 **취소 예정 픽스처가 없으면 누르지 않는다**) → typecheck·lint → commit `feat(crm): 관리자 승인 대기열 팝오버 — diff·승인/반려·착지 점프`

### Task 5: 사이드바 admin 메뉴 신설 + 배지

**Files:**
- Modify: `client/src/components/Sidebar.tsx` (admin 관리 구역에 MC 마스터 항목 + `pendingChangeRequestCount` prop + nav-count 배지), `client/src/App.tsx` (state + 60s interval + focus 재조회 — admin만, 실패 무소음)

- [ ] **Step 1: App.tsx** — `pendingChangeRequestCount` state. `isAdmin`일 때만: mount 시 + 60s interval + `window focus`에서 `getJson<unknown[]>("/api/catalog/change-requests?status=pending").then(rows => set(rows.length)).catch(() => {})` (effect 본문 setState 금지 — then 콜백 안). Sidebar에 prop 전달.
- [ ] **Step 2: Sidebar.tsx** — `canViewAdminMenu` 블록에 `["mc-master", "MC 마스터", "mc-master"]` 항목 신설(아이콘 name "mc-master" 기존재) + `{pendingChangeRequestCount > 0 ? <span className="nav-count num">{pendingChangeRequestCount}</span> : null}` (기존 배지 SSOT 마크업 그대로). activeView 하이라이트는 기존 딜러 메뉴의 mc-master 배선 재사용.
- [ ] **Step 3: 검증 후 커밋** — typecheck·lint + 실기(admin 사이드바에 메뉴+배지, staff/manager/dealer에겐 비노출 확인) → commit `feat(crm): 사이드바 admin MC 마스터 메뉴 신설 + 승인 대기 배지`

### Task 6: 클라 테스트 + 종합 검증 + PR

**Files:**
- Modify: `client/src/pages/MCMasterPage.test.tsx` (역할별 버튼 노출 + 팝오버 목록·승인 호출 스텁 케이스), 필요시 `client/src/App.test.tsx`(사이드바 메뉴 케이스)

- [ ] **Step 1: 테스트** — MCMasterPage.test.tsx 셸(getSession 목업 + fetch 스텁): ①admin → "승인 대기" 버튼 렌더 ②상담사/딜러 roleTab → 미렌더 ③팝오버 열면 스텁 목록 행·kind 라벨·diff 표시 ④승인 클릭 → `POST …/approve` fetch 호출 단언.
- [ ] **Step 2: 종합 검증** — `bun run typecheck && bun run lint && bun run knip && bun run format:check && bun run test:unit && bun run build` + 실 DB 3스위트(서버 변경분) 로컬.
- [ ] **Step 3: PR** — branch `feat/catalog-change-approval-admin-ui` → push → `gh pr create` "feat(crm): MC 마스터 변경 승인 — 관리자 대기열 UI (PR 2/3)" (본문: 요약·검증·PR 3 예고·🤖 푸터) → `gh pr checks --watch` 8단계 green.

---

## Self-Review 결과

- **Spec 커버**: §7.4(패널·diff·승인/반려·409 표시·착지 점프 — Task 3·4) · §7.5(사이드바 배지 — Task 5, 메뉴 신설 결정 명기) · §7.2의 관리자 축(모델 단위 배지는 PR 3 팀장 축과 함께가 자연스러워 **의도적 이월**) · PR 1 잔여 parsed.data(Task 2).
- **타입 일관**: `ChangeRequestItem` 좌표 3필드(Task 2 서버 ↔ Task 3 클라) · `ChangeRequestKind`(Task 1 lib ↔ 서버 re-export) 일치.
- **주의**: ①Task 1의 schema.ts 상대경로(`../../client/...`)는 기존 `client/src/data/*` import와 같은 깊이인지 구현 시 확인 ②Task 4 실기에서 승인 버튼은 실 카탈로그를 바꾸므로 누르지 않는다(픽스처는 PR 3 실기 때) ③knip: Task 1 라벨 맵이 Task 3까지 미소비 — 같은 PR 내 해소.
