# MC 마스터 변경 승인 워크플로 — PR 3 (팀장 개방) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 팀장(manager)에게 MC 마스터 편집 UI를 열되 저장의 결말이 202 큐 적재(토스트 "승인 요청됨")가 되고, 행 "승인 대기" 배지·"내 요청 (N)" 팝오버(취소·반려 사유)·승인 후 전 모델 캐시 무효화까지 붙인다.

**Architecture:** **서버 무변경**(202 분기·모델 단위 조회·mine=1·본인 취소 전부 PR 1 기존재). 클라 3층 — ①`catalog.ts` 쓰기 헬퍼 8종이 202 `{queued}`를 공통 감지·pub/sub(호출부 개별 수술 없음, spec §7.1) ②`catalog-change-requests.ts`에 배지/내 요청 훅 2종 ③MCMasterPage `canPropose` 축 + 부품(패널 라벨·OptionPanel 삭제 분리·사이드바 팀장 메뉴).

**Tech Stack:** React 19 + vitest(test:unit) + 기존 `.va-cr-*` 팝오버 부품 재사용.

**Spec:** `ref/specs/2026-07-30-crm-catalog-change-approval-design.md` §7.1~§7.3 (+§7.2 배지·브리프 이월 ④캐시)

**범위:** PR 3(팀장 개방)만. 클라 전용 — `src/` 서버 파일은 한 줄도 건드리지 않는다(Task 9에서 diff로 확인).

---

## 선행 사실 (2026-07-30 탐색 실측 — 계획의 전제)

- **서버 라우트 전부 기존재**: 202 = `c.json({ queued: true, requestId }, 202)`(`src/routes/catalog/change-request-kinds.ts:250`, manager 분기는 models.ts:40,52 · trims.ts:57,72 · options.ts:46,59,76,86). 타인 pending 409 body = `{ error: "이미 승인 대기 중인 요청이 있습니다.", requestedBy, requestedAt }`(UNIQUE 경합 폴백은 error만). 모델 단위 pending `GET /models/:id/change-requests`(admin·manager, status 고정 pending) · `GET /change-requests?mine=1`(전 상태·createdAt DESC·limit 50) · `DELETE /change-requests/:id`(본인 pending만 → canceled).
- **202가 현재 클라를 무증상 통과**: `sendRequest`(http.ts:31)는 `res.ok`(202 포함)면 통과, `sendJson`이 `{queued,…}`를 `CatalogTrim` 자리에 캐스팅. 호출부가 반환값을 안 써 지금은 무증상 — 감지 지점은 catalog.ts 쓰기 8종(create/update Model·Trim·Option + set/unsetNoOption). **예외 1곳**: OptionPanel `toggleNoOption`만 응답 후 로컬 상태를 뒤집는다(:131-137) → queued 체크 필수.
- **`HttpError`는 409의 requestedBy/requestedAt을 버린다**(http.ts:18 — error·status만). **결정: http.ts 확장 안 함** — 요청자·시각 안내는 행 배지(§7.2)가 예방선으로 담당하고, 패널에는 서버 메시지만 띄운다.
- **canEdit 사용처 12곳 분류**(MCMasterPage): 개방 = 추가 버튼(:358)·테이블 연필 3종(:480,:501,:530)·OptionPanel 추가/수정/무옵션(:582). canEdit 유지 = useTrimProposals(:94)·선택 토글(:363, 이게 일괄삭제+드래그 reorder의 유일한 관문 — `table-select.tsx:32` `draggable={selectMode}`)·고유번호(:408)·채택 3종(:483,:504)·승인 대기열 버튼 2곳(:390,:426 — 테스트 :216이 잠금)·OptionPanel 삭제(:252).
- **팀장 진입점 0**: 사이드바 MC 마스터는 canViewAdminMenu 블록(Sidebar.tsx:261), Topbar 설정도 admin 전용. 라우트는 무게이트(App.tsx:473). `Sidebar.test.tsx:74` "팀장 미노출" 케이스는 이번에 "노출(배지 없음)"로 갱신.
- **토스트 관례**: `App.showToast`(App.tsx:157) + 페이지 `onToast` prop(ChatPage 등) — MCMasterPage 두 라우트만 미배선(:473-474).
- **catalog-cache**: `makeCache` 클로저가 Map을 감춰 전역 무효화 API가 없다(catalog-cache.ts:30-51). 승인 후 타 모델은 30s 스테일(브리프 이월 ④) → `clear` 축 신설. MCMasterPage.test는 이 모듈 캐시를 초기화하지 않고 있었다 → 새 리셋 함수를 beforeEach에 표준 채용.
- **useStaffDirectory는 마운트 무조건 fetch**(staff.ts:42) → `enabled` 파라미터 후방호환 추가(딜러·상담사 화면에서 /api/staff 요청 억제).
- **MCMasterPage.test 스텁 함정**: `url.startsWith("/api/catalog/models")`(:117)·`startsWith("/api/catalog/trims")`(:116)가 앞이라 `/models/10/change-requests`·`/trims/100/options`·PATCH는 **그보다 위에** 분기를 넣어야 한다. `?mine=1`도 `startsWith("/api/catalog/change-requests")`(:122)보다 먼저.
- 재사용 부품: `.va-cr-*` CSS(vehicle-admin.css:878-959)·`popoverPosFromRect`/`usePopoverDismiss`·`buildChangeDiff`(Pick 시그니처)·`waitingLabel(iso, now, "전")`·`RowState` 패턴(ChangeRequestQueue.tsx:21).

---

## 사전 준비

- [ ] **브랜치 생성 + plan 커밋**

```bash
cd /Users/tobedoit/Documents/TypeScript/mr-cha-crm
git checkout main && git pull && git checkout -b feat/catalog-change-approval-manager
git add ref/plans/2026-07-30-crm-catalog-change-approval-pr3.md
git commit -m "docs(crm): 변경 승인 워크플로 PR3(팀장 개방) 계획

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: catalog.ts — 202 `{queued}` 공통 감지 + pub/sub (TDD)

**Files:**
- Modify: `client/src/lib/catalog.ts` (쓰기 8종 → wrapper 경유)
- Test: `client/src/lib/catalog.test.ts` (케이스 2개 추가)

- [ ] **Step 1: 실패하는 테스트 추가** — catalog.test.ts 끝에(기존 셸 그대로 — supabase mock·stubGlobal fetch 관례):

```ts
it("202 {queued}: 쓰기 헬퍼가 queued 표식을 반환하고 구독자에게 알린다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ queued: true, requestId: "cr-1" }), { status: 202 })),
  );
  let notified = 0;
  const unsub = onCatalogWriteQueued(() => {
    notified += 1;
  });
  const r = await updateTrim(1, { price: 2 });
  unsub();
  expect(isCatalogWriteQueued(r)).toBe(true);
  expect(notified).toBe(1);
});

it("200 정상 응답은 queued로 오인하지 않고 알림도 없다", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 200 })));
  let notified = 0;
  const unsub = onCatalogWriteQueued(() => {
    notified += 1;
  });
  const r = await updateTrim(1, { price: 2 });
  unsub();
  expect(isCatalogWriteQueued(r)).toBe(false);
  expect(notified).toBe(0);
});
```

import 줄에 `isCatalogWriteQueued, onCatalogWriteQueued` 추가.

- [ ] **Step 2: 실패 확인** — `bun run test:unit client/src/lib/catalog.test.ts` → FAIL(export 없음)

- [ ] **Step 3: 구현** — catalog.ts의 `// ── 차량 관리(admin)` 주석 아래(타입들 위)에 삽입:

```ts
// ── 변경 승인 큐 202 공통 감지(PR3, 2026-07-30) ────────────────────────────────
// manager의 catalog 쓰기는 서버가 즉시 실행하지 않고 202 { queued, requestId }로 큐에 쌓는다
// (src/routes/catalog/change-request-kinds.ts submitChangeRequest). 큐 대상 8종 헬퍼는 아래
// sendCatalogWrite를 거쳐 queued 응답을 감지·알림한다 — 호출부는 성공 흐름을 그대로 타고
// (패널 닫힘·재조회 — catalog가 안 바뀌었으니 재조회는 무해한 no-op), 토스트·배지 갱신은
// 구독자(MCMasterPage·배지 훅)가 담당한다(spec §7.1 "호출부 개별 수술 없음").
// 삭제·reorder·move·assign-codes는 admin 전용(202 불가)이라 sendJson 직행을 유지한다.
type CatalogWriteQueued = { queued: true; requestId: string };

export function isCatalogWriteQueued(value: unknown): value is CatalogWriteQueued {
  return typeof value === "object" && value !== null && (value as { queued?: unknown }).queued === true;
}

const writeQueuedListeners = new Set<() => void>();
export function onCatalogWriteQueued(listener: () => void): () => void {
  writeQueuedListeners.add(listener);
  return () => {
    writeQueuedListeners.delete(listener);
  };
}

async function sendCatalogWrite<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T | CatalogWriteQueued> {
  const result = await sendJson<T | CatalogWriteQueued>(url, method, body);
  if (isCatalogWriteQueued(result)) for (const l of writeQueuedListeners) l();
  return result;
}
```

그리고 큐 대상 8종의 `sendJson` → `sendCatalogWrite` + 반환 타입에 `| CatalogWriteQueued` 추가 (예시 — 나머지 6종 동일 패턴):

```ts
export async function createModel(input: {
  brandId: number;
  name: string;
  category: string | null;
  status: VehicleStatus;
}): Promise<CatalogModel | CatalogWriteQueued> {
  return sendCatalogWrite("/api/catalog/models", "POST", input);
}

export async function setNoOption(trimId: number): Promise<{ ok: boolean } | CatalogWriteQueued> {
  return sendCatalogWrite(`/api/catalog/trims/${trimId}/no-option`, "POST");
}
```

대상 8종 = `createModel`·`updateModel`·`createTrim`·`updateTrim`·`createOption`·`updateOption`·`setNoOption`·`unsetNoOption`. **delete 3종·assignMcCodes·reorder 2종·moveTrims는 그대로 둔다.** (`CatalogWriteQueued` 타입은 export하지 않는다 — 소비자는 가드로 좁힌다. #333 knip 선례상 미소비 export를 만들지 않는 축.)

- [ ] **Step 4: 통과 확인 후 커밋**

```bash
bun run test:unit client/src/lib/catalog.test.ts && bun run typecheck
git add client/src/lib/catalog.ts client/src/lib/catalog.test.ts
git commit -m "feat(crm): catalog 쓰기 헬퍼 202 queued 공통 감지 + 구독 채널

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: catalog-cache — clear 축 + 승인 후 전 모델 무효화 (TDD)

**Files:**
- Modify: `client/src/pages/mc-master/catalog-cache.ts`
- Test: `client/src/pages/mc-master/catalog-cache.test.ts` (케이스 추가 — 기존 파일 관례: 케이스별 고유 id로 모듈 캐시 격리)

- [ ] **Step 1: 실패하는 테스트 추가** (기존 파일의 fetch 스텁 관례에 맞춰 — 파일을 먼저 읽고 동형으로. 핵심 단언):

```ts
it("invalidateCatalogAfterApproval: 모델·트림·옵션요약·옵션 캐시를 비워 다음 load가 다시 fetch한다", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/options")) return new Response(JSON.stringify({ options: [], relations: [] }), { status: 200 });
      return new Response("[]", { status: 200 });
    }),
  );
  // 케이스 전용 고유 id — 모듈 캐시가 케이스를 넘겨 살아 있어도 충돌하지 않는다(파일 상단 주석 관례).
  await fetchModelsCached(9101);
  await fetchTrimsCached(9101);
  await fetchOptionSummaryCached(9101);
  await fetchOptionsCached(9101);
  const before = calls.length;
  await fetchModelsCached(9101); // 신선(30s 내) — fetch 없음
  expect(calls.length).toBe(before);

  invalidateCatalogAfterApproval();
  await fetchModelsCached(9101);
  await fetchTrimsCached(9101);
  await fetchOptionSummaryCached(9101);
  await fetchOptionsCached(9101);
  expect(calls.length).toBe(before + 4);
});

it("invalidateCatalogAfterApproval: 브랜드 캐시는 유지된다(승인 kind가 못 바꾸는 축)", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      return new Response("[]", { status: 200 });
    }),
  );
  await fetchBrandsCached();
  const before = calls.length;
  invalidateCatalogAfterApproval();
  await fetchBrandsCached();
  expect(calls.length).toBe(before);
});
```

- [ ] **Step 2: 실패 확인** — `bun run test:unit client/src/pages/mc-master/catalog-cache.test.ts` → FAIL

- [ ] **Step 3: 구현** — `CacheApi`에 clear 추가 + 말미에 export:

```ts
type CacheApi<T> = {
  get: (id: number) => T | undefined;
  load: (id: number, opts?: { force?: boolean }) => Promise<T>;
  clear: () => void;
};
```

`makeCache` 반환 객체에:

```ts
    // 전 항목 무효화 — inflight는 그대로 둔다: 진행 중 fetch가 clear 직전 값을 다시 심는 창은
    // 이론상 있으나 30s 신선도로 자기 치유되고, 기존(무효화 자체가 없던) 동작보다 나빠질 수 없다.
    clear: () => {
      cache.clear();
    },
```

파일 끝에:

```ts
// 변경 요청 승인 반영 후 전 모델 캐시 무효화(PR3 — 브리프 이월 ④). 승인 대상이 현재 화면 밖
// 모델이면 reloadTrims({force})가 닿지 않아 30s 스테일이 남는다 — 승인 성공 시 이걸 불러 다음
// 진입이 무조건 재조회하게 한다. brands·trimColors는 큐 대상 8종 kind가 못 바꾸는 축이라 유지.
// MCMasterPage.test.tsx beforeEach도 이걸로 케이스 간 모듈 캐시 누수를 끊는다(종전 리셋 API 부재).
export function invalidateCatalogAfterApproval(): void {
  modelsCache.clear();
  trimsCache.clear();
  optionSummaryCache.clear();
  optionsCache.clear();
}
```

- [ ] **Step 4: 통과 확인 후 커밋**

```bash
bun run test:unit client/src/pages/mc-master/catalog-cache.test.ts && bun run typecheck
git add client/src/pages/mc-master/catalog-cache.ts client/src/pages/mc-master/catalog-cache.test.ts
git commit -m "feat(crm): catalog 캐시 clear 축 — 승인 반영 후 전 모델 무효화

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: catalog-change-requests.ts — 배지·내 요청 훅 2종

**Files:**
- Modify: `client/src/lib/catalog-change-requests.ts`

훅 로직 검증은 Task 5~7의 MCMasterPage 통합 테스트가 잠근다(diff 빌더 등 순수부는 기존 테스트 유지). **knip 주의: 이 시점 미소비 export 2개(useModelPendingRequests·useMyChangeRequests)** — Task 5·7에서 해소, `knip.json` 등록 금지·보고만(PR 2 Task 1과 같은 처리).

- [ ] **Step 1: import에 catalog 채널 추가** — `import { onCatalogWriteQueued } from "./catalog";` (catalog.ts는 http만 import — 순환 없음)

- [ ] **Step 2: 파일 끝에 훅 2종 추가**

```ts
const EMPTY_ROWS: ChangeRequestItem[] = [];

// 모델 단위 pending — 트림/옵션 행 "승인 대기" 배지(spec §7.2, admin·manager 공용). 조회 실패
// 무소음: 배지는 409를 미리 보여주는 예방선일 뿐 최종 방어는 서버 부분 UNIQUE다. modelId 전환
// 직후 이전 모델 rows가 스치지 않게 응답을 modelId와 묶어 두고 소비 시점에 대조한다(effect 본문
// setState 금지 관례라 초기화 대신 파생 필터). 큐가 움직이면(202 적재 = catalog.ts 채널 /
// 승인·반려·취소 = 이 모듈 채널) 즉시 재조회한다.
export function useModelPendingRequests(modelId: number | null, enabled: boolean): ChangeRequestItem[] {
  const [data, setData] = useState<{ modelId: number; rows: ChangeRequestItem[] } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || modelId == null) return;
    let alive = true;
    getJson<ChangeRequestItem[]>(`/api/catalog/models/${modelId}/change-requests`)
      .then((rows) => {
        if (alive) setData({ modelId, rows });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, modelId, tick]);
  useEffect(() => onCatalogWriteQueued(() => setTick((t) => t + 1)), []);
  useEffect(() => onChangeRequestQueueUpdated(() => setTick((t) => t + 1)), []);
  return data != null && data.modelId === modelId ? data.rows : EMPTY_ROWS;
}

// 팀장 "내 요청" 팝오버(spec §7.3) — mine=1은 전 상태·최근 50건(서버 관례)이라 상태 구분은
// 클라 몫이다. 취소 성공은 notifyQueueUpdated로 알린다 — 모델 배지·(같은 브라우저의) 대기열이
// 60s 폴링을 기다리지 않고 따라온다. 내 저장이 202로 적재되면 (N)도 즉시 갱신(catalog.ts 채널).
export function useMyChangeRequests(enabled: boolean): {
  rows: ChangeRequestItem[] | null;
  failed: boolean;
  reload: () => void;
  cancel: (id: string) => Promise<void>;
} {
  const [rows, setRows] = useState<ChangeRequestItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getJson<ChangeRequestItem[]>("/api/catalog/change-requests?mine=1")
      .then((list) => {
        if (!alive) return;
        setRows(list);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled, tick]);
  useEffect(() => onCatalogWriteQueued(() => setTick((t) => t + 1)), []);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const cancel = useCallback(async (id: string) => {
    await sendJson(`/api/catalog/change-requests/${id}`, "DELETE");
    setTick((t) => t + 1);
    notifyQueueUpdated();
  }, []);
  return { rows, failed, reload, cancel };
}
```

- [ ] **Step 3: 검증 후 커밋** — `bun run typecheck && bun run lint` (knip은 미소비 2건이라 이 시점 건너뜀 — Task 9에서 전체)

```bash
git add client/src/lib/catalog-change-requests.ts
git commit -m "feat(crm): 변경 요청 클라 훅 — 모델 단위 배지·내 요청(취소 포함)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 편집 부품 3종 (동작 불변 확장 — 잠금은 Task 5 테스트)

**Files:**
- Modify: `client/src/pages/mc-master/TrimEditPanel.tsx`, `client/src/pages/mc-master/ModelEditPanel.tsx`, `client/src/pages/mc-master/OptionPanel.tsx`, `client/src/lib/staff.ts`

- [ ] **Step 1: 패널 2종에 `submitLabel` prop** — TrimEditPanel·ModelEditPanel 공통 패턴:

props 타입에 `submitLabel?: string;` 추가 + 구조분해에 `submitLabel = "저장",` (주석: `// 팀장 제안 축은 "승인 요청" — 같은 폼, 다른 결말(spec §7.1)`) → 제출 버튼 텍스트를 `{busy ? "저장 중…" : submitLabel}`로.

- [ ] **Step 2: OptionPanel — 삭제 축 분리 + 무옵션 토글 queued 체크**

props에 `canDelete: boolean;` 추가(구조분해 포함, 주석: `// 삭제는 admin 전용 — canEdit(쓰기 개방=admin|manager)와 축이 다르다(spec §3.2)`). 옵션 행 액션 블록(`canEdit && <span className="va-opt-actions">…`)을:

```tsx
                  {canEdit && (
                    <span className="va-opt-actions">
                      <button
                        type="button"
                        className="tiny-btn"
                        aria-label={`${o.name} 수정`}
                        onClick={() => startEdit(o)}
                      >
                        <Pencil size={13} />
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          className="tiny-btn va-danger"
                          aria-label={`${o.name} 삭제`}
                          onClick={() => del(o)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </span>
                  )}
```

`toggleNoOption`을 queued 인지형으로(import에 `isCatalogWriteQueued` 추가):

```tsx
  function toggleNoOption() {
    void withBusy(async () => {
      // 팀장(202 큐 적재)은 아직 반영 전 — 로컬 noOption을 뒤집으면 "즉시 반영된 것처럼" 읽힌다
      // (spec §7.1 로컬 상태 미반영). 즉시 실행(admin)일 때만 토글한다.
      if (noOption) {
        const r = await unsetNoOption(trim.id);
        if (!isCatalogWriteQueued(r)) setNoOptionState(false);
      } else {
        const r = await setNoOption(trim.id);
        if (!isCatalogWriteQueued(r)) setNoOptionState(true);
      }
    });
  }
```

- [ ] **Step 3: `useStaffDirectory(enabled = true)`** — staff.ts 훅 시그니처를 `export function useStaffDirectory(enabled = true): …`로, effect 첫 줄에 `if (!enabled) return;` + deps `[enabled]`. (주석: `// enabled=false면 fetch 자체를 보내지 않는다 — MC 마스터 배지가 admin·manager에서만 이름을 쓴다(딜러·상담사 화면에서 /api/staff 요청 억제).`) 기존 호출부는 무인자라 무변경.

- [ ] **Step 4: 검증 후 커밋** — `bun run typecheck && bun run lint && bun run test:unit` (전량 — 기존 스위트 회귀 확인)

```bash
git add client/src/pages/mc-master/TrimEditPanel.tsx client/src/pages/mc-master/ModelEditPanel.tsx client/src/pages/mc-master/OptionPanel.tsx client/src/lib/staff.ts
git commit -m "feat(crm): 편집 부품 팀장 축 준비 — submitLabel·옵션 삭제 분리·무옵션 queued 체크

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: MCMasterPage canPropose 개방 + 202 토스트 + App 배선 (+ 역할 테스트)

**Files:**
- Modify: `client/src/pages/MCMasterPage.tsx`, `client/src/App.tsx` (mc-master 라우트 2곳 onToast)
- Test: `client/src/pages/MCMasterPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 추가** — 셸 갱신 + 케이스 5개.

셸 갱신(파일 상단):

```tsx
import { invalidateCatalogAfterApproval } from "./mc-master/catalog-cache";
```

`renderPage`에 onToast 파라미터(기존 호출부 무변경):

```tsx
function renderPage(roleTab: RoleTab, entry = "/mc-master", onToast: (m: string) => void = () => {}) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} onToast={onToast} />} />
        <Route path="/mc-master/:modelId" element={<MCMasterPage roleTab={roleTab} onToast={onToast} />} />
      </Routes>
    </MemoryRouter>,
  );
}
```

가변 스텁 상태 추가(changeRequestQueue 옆):

```tsx
let modelPendingRows: ChangeRequestItem[] = [];
let myRequests: ChangeRequestItem[] = [];
let trimPatchResponse: { status: number; body: unknown } = { status: 200, body: { id: 100 } };
```

`beforeEach`에: 위 3개 초기화(`modelPendingRows = []; myRequests = []; trimPatchResponse = { status: 200, body: { id: 100 } };`) + `invalidateCatalogAfterApproval();`(주석: `// 30s 모듈 캐시도 케이스 간 누수 — PR3에서 생긴 리셋 API로 표준 초기화.`). fetch 스텁의 **기존 분기들보다 위에**(주석 포함):

```tsx
      // ⚠️ 분기 순서: 아래 startsWith("/api/catalog/models")·("/api/catalog/trims")·
      // ("/api/catalog/change-requests")가 광범위 매칭이라, 구체 URL은 반드시 그 위에 둔다.
      if (url === "/api/catalog/models/10/change-requests")
        return new Response(JSON.stringify(modelPendingRows), { status: 200 });
      if (url === "/api/catalog/change-requests?mine=1")
        return new Response(JSON.stringify(myRequests), { status: 200 });
      if (init?.method === "DELETE" && url.startsWith("/api/catalog/change-requests/"))
        return new Response(JSON.stringify({ status: "canceled" }), { status: 200 });
      if (init?.method === "PATCH" && url === "/api/catalog/trims/100")
        return new Response(JSON.stringify(trimPatchResponse.body), { status: trimPatchResponse.status });
      if (url === "/api/catalog/trims/100/options")
        return new Response(
          JSON.stringify({ options: [{ id: 900, type: "basic", name: "선루프", price: 500000 }], relations: [] }),
          { status: 200 },
        );
```

케이스 5개(파일 끝, `// ── PR3: 팀장(canPropose) 개방` 구획 주석 아래):

```tsx
it("팀장: 모델 추가·수정 진입은 열리고 선택(일괄삭제·순서변경) 토글은 없다", async () => {
  renderPage("팀장");
  await screen.findByText("그랜저");
  expect(screen.getByRole("button", { name: /모델 추가/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "그랜저 수정" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^선택$/ })).toBeNull();
});

it("팀장 트림 뷰: 트림 추가·수정은 열리고 고유번호 할당은 없고 저장 버튼은 '승인 요청'", async () => {
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  expect(screen.getByRole("button", { name: /트림 추가/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /고유번호 할당/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  expect(await screen.findByRole("button", { name: "승인 요청" })).toBeInTheDocument();
});

it("팀장 저장(202 queued): 토스트가 뜨고 패널이 닫힌다", async () => {
  trimPatchResponse = { status: 202, body: { queued: true, requestId: "cr-9" } };
  const toasts: string[] = [];
  const user = userEvent.setup();
  renderPage("팀장", "/mc-master", (m) => toasts.push(m));
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  await user.click(await screen.findByRole("button", { name: "승인 요청" }));
  await waitFor(() => {
    expect(toasts).toContain("승인 요청됨 — 관리자 컨펌 후 반영됩니다");
  });
  expect(
    fetchCalls.some(([url, init]) => url === "/api/catalog/trims/100" && init?.method === "PATCH"),
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "승인 요청" })).toBeNull(); // 패널 닫힘(성공 흐름)
});

it("팀장 저장(409 타인 pending): 패널에 서버 메시지가 뜨고 열려 있다", async () => {
  trimPatchResponse = { status: 409, body: { error: "이미 승인 대기 중인 요청이 있습니다." } };
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(screen.getByRole("button", { name: "캐스퍼 1.0 수정" }));
  await user.click(await screen.findByRole("button", { name: "승인 요청" }));
  expect(await screen.findByText("이미 승인 대기 중인 요청이 있습니다.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "승인 요청" })).toBeInTheDocument(); // 패널 유지
});

it("팀장 옵션 패널: 추가·수정은 열리고 삭제는 없다", async () => {
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  await user.click(screen.getByRole("button", { name: "옵션 미입력" }));
  expect(await screen.findByRole("button", { name: "선루프 수정" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "선루프 삭제" })).toBeNull();
  expect(screen.getByRole("button", { name: /기본 옵션 추가/ })).toBeInTheDocument();
});
```

- [ ] **Step 2: 실패 확인** — `bun run test:unit client/src/pages/MCMasterPage.test.tsx` → 새 케이스 5개 FAIL(onToast prop 없음 → TS 에러부터), 기존 케이스는 셸 갱신 후에도 GREEN이어야 한다.

- [ ] **Step 3: MCMasterPage 구현**

(a) props·게이트(:48-49):

```tsx
export function MCMasterPage({ roleTab, onToast }: { roleTab: RoleTab; onToast: (message: string) => void }) {
  const canEdit = roleTab === "최고관리자";
  // 팀장 제안 축(PR3, spec §7.1) — 편집 UI는 admin과 같게 열되 저장의 결말이 다르다(202 큐 적재).
  // canEdit 전용으로 남는 것: 삭제·모델 이동·선택 모드(=드래그 reorder 관문)·고유번호·딜러 제안
  // 채택·승인 대기열 버튼(테스트 "팀장은 승인 대기 버튼을 렌더하지 않는다"가 잠금).
  const canPropose = roleTab === "팀장";
  const canWrite = canEdit || canPropose;
```

(b) 202 토스트 구독 + 배지 데이터(기존 훅들 아래, useTrimProposals 근처) — import 추가: `isCatalogWriteQueued`는 불필요, `onCatalogWriteQueued`(lib/catalog), `useModelPendingRequests`(lib/catalog-change-requests), `CHANGE_KIND_LABELS`(lib/catalog-change-kinds), `waitingLabel`(lib/chat), `useStaffDirectory`(lib/staff), `invalidateCatalogAfterApproval`(./mc-master/catalog-cache), `MyChangeRequestsButton`은 Task 7에서:

```tsx
  // 팀장 저장의 202 큐 적재 공통 처리(spec §7.1) — 쓰기 헬퍼(catalog.ts)가 감지·알림하고 여기
  // 한 곳만 토스트를 단다. 저장 흐름은 성공 경로 그대로(패널 닫힘·재조회 no-op)라 호출부 개별
  // 수술이 없다. 409(타인 pending)는 기존 catch → panelError로 흐른다(요청자·시각은 행 배지가
  // 예방선으로 이미 보여준다 — HttpError 확장 안 함, PR3 결정).
  useEffect(() => onCatalogWriteQueued(() => onToast("승인 요청됨 — 관리자 컨펌 후 반영됩니다")), [onToast]);

  // 행 "승인 대기" 배지 재료(spec §7.2, admin·manager) — 모델 단위 pending + 요청자 이름.
  const { staff } = useStaffDirectory(canWrite);
  const pendingRows = useModelPendingRequests(modelId ? Number(modelId) : null, canWrite);
  const staffNames = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);
  // targetTrimId가 있는 요청(트림 수정·무옵션·옵션류)은 그 트림 행에, 없는 요청(트림 추가·모델
  // 수정)은 헤더 pill로 — 시도 전에 보여 409 자체를 예방한다.
  const changeBadges = useMemo(() => {
    const byTrim = new Map<number, string>();
    const headerLines: string[] = [];
    if (pendingRows.length > 0) {
      const now = new Date();
      const linesByTrim = new Map<number, string[]>();
      for (const r of pendingRows) {
        const line = `${staffNames.get(r.requestedBy) ?? "알 수 없음"} · ${waitingLabel(r.createdAt, now, "전")} · ${CHANGE_KIND_LABELS[r.kind]}`;
        if (r.targetTrimId != null) {
          const arr = linesByTrim.get(r.targetTrimId) ?? [];
          arr.push(line);
          linesByTrim.set(r.targetTrimId, arr);
        } else {
          headerLines.push(line);
        }
      }
      for (const [trimId, lines] of linesByTrim) byTrim.set(trimId, lines.join("\n"));
    }
    return { byTrim, headerLines };
  }, [pendingRows, staffNames]);
```

(배지 **렌더링**은 Task 6에서 — 이 Task에서는 재료 계산까지만 넣으면 lint의 미사용 변수에 걸린다. 따라서 **changeBadges·staffNames·pendingRows 블록은 Task 6으로 미룬다.** 이 Task에서는 (b) 중 토스트 구독 한 줄만 넣는다.)

(c) editActions 재구성(:338-373) — 바깥 게이트 canWrite, 선택 토글만 canEdit:

```tsx
  const editActions = (
    onAdd: () => void,
    addLabel: string,
    allowSelect = true,
    extra: ReactNode = null,
    onMove: (() => void) | null = null,
  ) =>
    canWrite ? (
      <div className="va-head-actions">
        {allowSelect && selectMode && selected.size > 0 && (
          <button type="button" className="btn va-danger-btn" onClick={bulkDelete}>
            선택 삭제 ({selected.size})
          </button>
        )}
        {allowSelect && selectMode && selected.size > 0 && onMove && (
          <button type="button" className="btn" onClick={onMove}>
            <FolderInput size={15} /> 모델 이동
          </button>
        )}
        {!selectMode && extra}
        {!selectMode && (
          <button type="button" className="btn primary" onClick={onAdd}>
            <Plus size={15} /> {addLabel}
          </button>
        )}
        {/* 선택 모드는 일괄삭제·드래그 reorder의 유일한 관문(table-select draggable={selectMode})
            — canEdit로 잠그면 팀장에게 둘 다 함께 닫힌다(spec §3.2 admin 전용 9종). 위의 삭제/이동
            버튼은 selectMode 안에서만 렌더되므로 팀장 화면에는 애초에 도달하지 않는다. */}
        {canEdit && allowSelect && (
          <button
            type="button"
            className={`btn${selectMode ? " va-select-on" : ""}`}
            onClick={toggleSelectMode}
          >
            <CheckSquare size={15} /> {selectMode ? "취소" : "선택"}
          </button>
        )}
      </div>
    ) : null;
```

(d) 승인 반영 콜백 추출(캐시 무효화 포함) — 두 `ChangeRequestQueueButton onApplied` 인라인을 하나로:

```tsx
  // 승인 반영 후 재조회 — 승인 대상이 현재 화면 밖 모델일 수 있어 전 모델 캐시를 먼저 비운다
  // (30s 스테일 이월 항목 해소, catalog-cache invalidateCatalogAfterApproval 주석 참조).
  const handleQueueApplied = () => {
    invalidateCatalogAfterApproval();
    reloadModels();
    if (modelId) {
      reloadTrims();
      reloadOptionSummary();
    }
  };
```

두 곳 모두 `{canEdit && <ChangeRequestQueueButton onApplied={handleQueueApplied} />}`로 교체(트림 뷰 :390-400, 모델 목록 :426-436).

(e) 테이블·패널 배선: `GroupedTrimTable`·`TrimTable`·`ModelTable`의 `canEdit={canEdit}` → `canEdit={canWrite}`(연필 = 편집 패널 진입 — 팀장 개방. `proposalsByTrim`/`onAdopt`/`onUndo`의 `canEdit ? … : undefined`는 **그대로**). 패널:

```tsx
      {modelPanel && (
        <ModelEditPanel
          model={modelPanel.mode === "edit" ? modelPanel.model : null}
          busy={busy}
          error={panelError}
          submitLabel={canPropose ? "승인 요청" : "저장"}
          onClose={() => setModelPanel(null)}
          onSubmit={submitModel}
        />
      )}
```

TrimEditPanel도 동일하게 `submitLabel={canPropose ? "승인 요청" : "저장"}` 추가. OptionPanel은 `canEdit={canWrite} canDelete={canEdit}`로.

(f) App.tsx :473-474 두 라우트에 `onToast={showToast}`:

```tsx
        <Route path="/mc-master" element={<MCMasterPage roleTab={roleTab} onToast={showToast} />} />
        <Route path="/mc-master/:modelId" element={<MCMasterPage roleTab={roleTab} onToast={showToast} />} />
```

- [ ] **Step 4: 통과 확인** — `bun run test:unit client/src/pages/MCMasterPage.test.tsx` → 기존 + 신규 5개 전부 PASS (특히 기존 "팀장은 승인 대기 버튼을 렌더하지 않는다"·"상담사는 편집 버튼 숨김" GREEN 유지). `bun run typecheck && bun run lint`.

- [ ] **Step 5: 커밋**

```bash
git add client/src/pages/MCMasterPage.tsx client/src/App.tsx client/src/pages/MCMasterPage.test.tsx
git commit -m "feat(crm): MC 마스터 팀장 개방 — canPropose 축·승인 요청 저장·202 토스트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 행 "승인 대기" 배지 + 헤더 pill (TDD)

**Files:**
- Modify: `client/src/pages/MCMasterPage.tsx` (배지 재료 계산 + 헤더 pill), `client/src/pages/mc-master/GroupedTrimTable.tsx`, `client/src/pages/mc-master/TrimTable.tsx`, `client/src/styles/vehicle-admin.css`
- Test: `client/src/pages/MCMasterPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 추가**

```tsx
it("승인 대기 중인 트림 행에 배지가 뜬다(호버 title = 요청자·경과·작업)", async () => {
  modelPendingRows = [{ ...PENDING_ROW, targetId: 100, targetBrandId: 1, targetModelId: 10, targetTrimId: 100 }];
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  await screen.findByText("캐스퍼 1.0");
  const badge = await screen.findByText("승인 대기"); // 행 배지(팀장에겐 "승인 대기 (N)" 헤더 버튼이 없어 유일)
  expect(badge.getAttribute("title")).toContain("박서준");
  expect(badge.getAttribute("title")).toContain("트림 수정");
});

it("트림 행에 못 붙는 요청(트림 추가 등)은 트림 뷰 헤더 pill로 집계된다", async () => {
  modelPendingRows = [
    {
      ...PENDING_ROW,
      id: "cr-2",
      kind: "trim.create",
      targetId: null,
      targetBrandId: 1,
      targetModelId: 10,
      targetTrimId: null,
      payload: { modelId: 10, trimName: "새 트림", price: 1, modelYear: 2027, fuelType: "가솔린" },
      snapshot: {},
    },
  ];
  const user = userEvent.setup();
  renderPage("팀장");
  await user.click(await screen.findByRole("button", { name: "그랜저" }));
  expect(await screen.findByText("승인 대기 1")).toBeInTheDocument();
});
```

- [ ] **Step 2: 실패 확인** — `bun run test:unit client/src/pages/MCMasterPage.test.tsx` → 신규 2개 FAIL

- [ ] **Step 3: 구현**

(a) MCMasterPage에 Task 5-(b)에서 미뤄둔 배지 재료 블록(useStaffDirectory·useModelPendingRequests·staffNames·changeBadges — 코드는 Task 5 Step 3-(b) 그대로)을 추가하고 import를 채운다.

(b) 트림 뷰 헤더 pill — `va-head-back`의 `<h2>` 닫힌 직후:

```tsx
              {changeBadges.headerLines.length > 0 && (
                <span className="va-cr-badge" title={changeBadges.headerLines.join("\n")}>
                  승인 대기 {changeBadges.headerLines.length}
                </span>
              )}
```

(c) 테이블 2종에 optional prop 추가 — `pendingBadgeByTrim?: Map<number, string>;` (props 타입 + 구조분해, 주석: `/** 트림별 "승인 대기" 배지 title(요청자·경과·작업 — MCMasterPage가 합성). 없으면 미표시. */`).

GroupedTrimTable 행(트림명 셀):

```tsx
                    <td className="va-grade-cell">
                      <div className="va-trim-name">
                        {trimGrade(t.trimName)}
                        {pendingBadgeByTrim?.has(t.id) && (
                          <span className="va-cr-badge" title={pendingBadgeByTrim.get(t.id)}>
                            승인 대기
                          </span>
                        )}
                      </div>
                      <ColorChips colors={colorsByTrim.get(t.id) ?? []} />
                    </td>
```

TrimTable 행(트림명 셀) 동일 패턴:

```tsx
            <td className="va-th-trim">
              <div className="va-trim-name">
                {t.trimName}
                {pendingBadgeByTrim?.has(t.id) && (
                  <span className="va-cr-badge" title={pendingBadgeByTrim.get(t.id)}>
                    승인 대기
                  </span>
                )}
              </div>
              <ColorChips colors={colorsByTrim.get(t.id) ?? []} />
            </td>
```

MCMasterPage 두 테이블 호출에 `pendingBadgeByTrim={changeBadges.byTrim}` 전달. (ModelTable은 제외 — 모델 목록 행 배지는 모델별 N회 조회가 필요해 범위 밖, spec §7.2도 "트림/옵션 행"만 명시. 옵션 행 단위 배지도 같은 이유로 트림 행 배지의 title이 "옵션 수정" 라벨로 대신한다 — 한계 명기.)

(d) CSS — vehicle-admin.css의 `.va-cr-*` 블록(≈:959) 뒤에(이웃 룰이 색 토큰 `var(--…)`을 쓰면 그 축으로 맞출 것):

```css
/* ── 행 "승인 대기" 배지(PR3 spec §7.2) — 시도 전에 보여 409(타인 pending)를 예방한다.
   title 속성에 "요청자 · 경과 · 작업"(여러 건은 줄바꿈)이 실린다. */
.va-cr-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  background: rgba(180, 83, 9, 0.12);
  color: #b45309;
  white-space: nowrap;
  vertical-align: 1px;
}
```

- [ ] **Step 4: 통과 확인 후 커밋** — `bun run test:unit client/src/pages/MCMasterPage.test.tsx && bun run typecheck && bun run lint`

```bash
git add client/src/pages/MCMasterPage.tsx client/src/pages/mc-master/GroupedTrimTable.tsx client/src/pages/mc-master/TrimTable.tsx client/src/styles/vehicle-admin.css client/src/pages/MCMasterPage.test.tsx
git commit -m "feat(crm): 트림 행 승인 대기 배지 + 헤더 pill — 중복 요청 예방선

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: "내 요청 (N)" 팝오버 (TDD)

**Files:**
- Create: `client/src/components/MyChangeRequests.tsx`
- Modify: `client/src/pages/MCMasterPage.tsx` (헤더 2분기 배선), `client/src/styles/vehicle-admin.css` (상태 칩·사유)
- Test: `client/src/pages/MCMasterPage.test.tsx`

- [ ] **Step 1: 실패하는 테스트 추가**

```tsx
it("팀장: 내 요청 (N) — 반려 사유가 보이고 pending 행 취소가 DELETE를 쏜다", async () => {
  myRequests = [
    { ...PENDING_ROW, id: "cr-p", status: "pending" },
    { ...PENDING_ROW, id: "cr-r", status: "rejected", rejectReason: "가격 근거 부족" },
  ];
  const user = userEvent.setup();
  renderPage("팀장");
  await screen.findByText("그랜저");
  await user.click(await screen.findByRole("button", { name: "내 요청 (1)" })); // (N)=pending만
  expect(await screen.findByText(/반려 사유: 가격 근거 부족/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "취소" }));
  await waitFor(() => {
    expect(
      fetchCalls.some(([url, init]) => url === "/api/catalog/change-requests/cr-p" && init?.method === "DELETE"),
    ).toBe(true);
  });
});

it("내 요청 버튼은 팀장 전용 — 관리자·상담사에겐 없다", async () => {
  renderPage("최고관리자");
  await screen.findByText("그랜저");
  expect(screen.queryByRole("button", { name: /내 요청/ })).toBeNull();
});
```

- [ ] **Step 2: 실패 확인** — 신규 2개 FAIL

- [ ] **Step 3: 컴포넌트 구현** — `client/src/components/MyChangeRequests.tsx` 전체:

```tsx
import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import { popoverPosFromRect, type PopoverPos } from "@/components/ProposalTrimsPopover";
import { CHANGE_KIND_LABELS } from "@/lib/catalog-change-kinds";
import { buildChangeDiff, useMyChangeRequests, type ChangeRequestItem } from "@/lib/catalog-change-requests";
import { waitingLabel } from "@/lib/chat";
import { usePopoverDismiss } from "@/lib/usePopoverDismiss";
import { mcMasterPath } from "@/pages/mc-master/mc-master-route";

// 팀장 "내 요청" 팝오버(PR3, spec §7.3) — 반려 사유 확인 → 수정 → 재요청 셀프서비스.
// 대기열 팝오버(ChangeRequestQueue)와 같은 셸(.va-cr-*)이되 액션이 다르다: 승인/반려 대신
// pending 행 [취소] + rejected 행 사유 표시. 요청자가 전부 본인이라 이름 열이 없고, canceled는
// 소음이라 걸러낸다(서버 mine=1은 전 상태 최근 50건). 버튼 (N)은 pending만 센다 — 지금 걸려
// 있는 것만이 행동 대상이다.
type RowState = { phase: "idle" } | { phase: "busy" } | { phase: "done" } | { phase: "error"; message: string };

const IDLE_STATE: RowState = { phase: "idle" };

const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
};

export function MyChangeRequestsButton() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const { rows, failed, reload, cancel } = useMyChangeRequests(true);
  const navigate = useNavigate();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  usePopoverDismiss(popRef, open, () => setOpen(false));

  function stateOf(id: string): RowState {
    return rowStates[id] ?? IDLE_STATE;
  }
  function setRowState(id: string, s: RowState) {
    setRowStates((prev) => ({ ...prev, [id]: s }));
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setPos(popoverPosFromRect(btnRef.current?.getBoundingClientRect()));
    setOpen(true);
    reload(); // 신선도 — 열려 있지 않은 사이 관리자가 처리했을 수 있다.
  }

  async function handleCancel(row: ChangeRequestItem) {
    setRowState(row.id, { phase: "busy" });
    try {
      await cancel(row.id);
      setRowState(row.id, { phase: "done" }); // 재조회 완료 전 즉시 숨김(대기열 팝오버와 같은 규칙).
    } catch (e) {
      setRowState(row.id, { phase: "error", message: e instanceof Error ? e.message : "취소 실패" });
    }
  }

  // 착지 점프 — ChangeRequestQueue.jumpTo와 같은 좌표 규칙(brand 쿼리 필수·트림은 hl 플래시).
  function jumpTo(row: ChangeRequestItem) {
    if (row.targetBrandId == null) return;
    const dest =
      row.targetModelId != null
        ? `${mcMasterPath(row.targetBrandId, row.targetModelId)}${
            row.targetTrimId != null ? `&hl=${row.targetTrimId}` : ""
          }`
        : mcMasterPath(row.targetBrandId, undefined);
    navigate(dest);
    setOpen(false);
  }

  const visibleRows = rows?.filter((r) => r.status !== "canceled" && stateOf(r.id).phase !== "done") ?? null;
  const pendingCount = visibleRows == null ? null : visibleRows.filter((r) => r.status === "pending").length;

  return (
    <>
      <button className="btn" onClick={toggle} ref={btnRef} type="button">
        내 요청{pendingCount != null ? ` (${pendingCount})` : ""}
      </button>
      {open && (
        <div
          className="va-cr-pop"
          ref={popRef}
          style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : undefined}
        >
          {visibleRows === null && !failed && <div className="va-cr-note">불러오는 중…</div>}
          {failed && (
            <div className="va-cr-note">
              불러오기 실패{" "}
              <button type="button" className="tiny-btn" onClick={reload}>
                다시 시도
              </button>
            </div>
          )}
          {visibleRows != null && !failed && visibleRows.length === 0 && (
            <div className="va-cr-note">요청 내역이 없습니다.</div>
          )}
          {visibleRows?.map((row) => {
            const state = stateOf(row.id);
            const diff = buildChangeDiff(row);
            const canJump = row.targetBrandId != null;
            return (
              <div className="va-cr-row" key={row.id}>
                <div className="va-cr-row-head">
                  <span className={`va-cr-status va-cr-status-${row.status}`}>
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                  {" · "}
                  <span>{waitingLabel(row.createdAt, new Date(), "전")}</span>
                  {" · "}
                  <span>{CHANGE_KIND_LABELS[row.kind]}</span>
                </div>
                {canJump ? (
                  <button type="button" className="va-cr-target" onClick={() => jumpTo(row)}>
                    {row.targetLabel}
                  </button>
                ) : (
                  <span className="va-cr-target-text">{row.targetLabel}</span>
                )}
                {diff.length > 0 && (
                  <div className="va-cr-diff">
                    {diff.map((d) => (
                      <div key={d.label}>
                        {d.label}: {d.before ?? "—"} → {d.after}
                      </div>
                    ))}
                  </div>
                )}
                {row.status === "rejected" && row.rejectReason && (
                  <div className="va-cr-reason">반려 사유: {row.rejectReason}</div>
                )}
                {state.phase === "error" && <div className="va-cr-error">{state.message}</div>}
                {row.status === "pending" && (
                  <div className="va-cr-actions">
                    <button type="button" onClick={() => void handleCancel(row)} disabled={state.phase === "busy"}>
                      취소
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: 배선 + CSS**

MCMasterPage — import `MyChangeRequestsButton`, 헤더 두 분기에서 `{canEdit && <ChangeRequestQueueButton …/>}` **바로 뒤에** `{canPropose && <MyChangeRequestsButton />}` (트림 뷰·모델 목록 각 1곳, 주석: `{/* 팀장 셀프 현황(spec §7.3) — 관리자 대기열 버튼과 같은 자리, 다른 역할. */}`).

vehicle-admin.css — `.va-cr-badge` 아래에:

```css
/* 내 요청 상태 칩(PR3 spec §7.3) */
.va-cr-status {
  display: inline-block;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.va-cr-status-pending {
  background: rgba(180, 83, 9, 0.12);
  color: #b45309;
}
.va-cr-status-approved {
  background: rgba(21, 128, 61, 0.12);
  color: #15803d;
}
.va-cr-status-rejected {
  background: rgba(185, 28, 28, 0.12);
  color: #b91c1c;
}
.va-cr-reason {
  margin-top: 4px;
  font-size: 12px;
  color: #b91c1c;
}
```

- [ ] **Step 5: 통과 확인 후 커밋** — `bun run test:unit client/src/pages/MCMasterPage.test.tsx && bun run typecheck && bun run lint`

```bash
git add client/src/components/MyChangeRequests.tsx client/src/pages/MCMasterPage.tsx client/src/styles/vehicle-admin.css client/src/pages/MCMasterPage.test.tsx
git commit -m "feat(crm): 팀장 '내 요청' 팝오버 — 취소·반려 사유·착지 점프

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 사이드바 팀장 진입점 (TDD)

**Files:**
- Modify: `client/src/components/Sidebar.tsx`
- Test: `client/src/components/Sidebar.test.tsx` (팀장 케이스 갱신)

배경: 팀장은 현재 mc-master 진입점이 0(사이드바·Topbar 모두 admin 전용, 라우트는 무게이트라 URL 직접뿐) — 편집 제안을 열면서 메뉴가 없으면 죽은 기능이다. **배지는 admin 전용 유지**(App 폴링이 isAdmin 게이트·manager는 그 URL이 403·팀장 셀프 현황은 화면 안 "내 요청"이 담당). Topbar 설정 팝오버는 admin 전용 그대로(범위 밖).

- [ ] **Step 1: 테스트 갱신(먼저)** — Sidebar.test.tsx의 기존 "팀장 — MC 마스터 항목 미노출" 케이스(≈:74-76)를 교체 + describe 위 주석(≈:63-65)도 아래 취지로 갱신:

```tsx
// MC 마스터 진입점 role 게이트 — admin은 관리 구역(배지 포함), 팀장은 PR3(제안 축 개방)로
// 팀 구역에 배지 없는 항목이 생겼다(배지 = 승인 대기 건수 = admin의 일감 — App 폴링도 admin 전용).
it("팀장 — MC 마스터 항목 노출(PR3 제안 진입점) · 승인 대기 배지는 없음", () => {
  render(<Sidebar {...baseProps} roleTab="팀장" pendingChangeRequestCount={3} onViewChange={vi.fn()} />);
  const button = screen.getByRole("button", { name: "MC 마스터" });
  expect(button).toBeInTheDocument();
  expect(button.textContent).not.toContain("3");
});
```

- [ ] **Step 2: 실패 확인** — `bun run test:unit client/src/components/Sidebar.test.tsx` → 갱신 케이스 FAIL

- [ ] **Step 3: 구현** — Sidebar.tsx의 "팀원 관리" 버튼(≈:246) 바로 아래, canViewAdminMenu 블록 밖에:

```tsx
            {/* MC 마스터 팀장 진입점(PR3, 2026-07-30) — 편집 제안(canPropose)이 열리면서 필요해졌다
                (종전 진입점은 admin 전용 2곳뿐). admin은 아래 관리 구역의 기존 항목(승인 대기 배지
                포함)을 그대로 쓴다 — 배지는 admin의 일감 카운트라 팀장 항목에는 달지 않는다(팀장
                셀프 현황은 MC 마스터 화면 안 "내 요청 (N)"이 담당). */}
            {roleTab === "팀장" && (
              <button aria-label="MC 마스터" className={navButtonClass(visibleActiveView === "mc-master")} data-label="MC 마스터" onClick={() => navigate("mc-master")} type="button"><MenuIcon name="mc-master" /><span>MC 마스터</span></button>
            )}
```

- [ ] **Step 4: 통과 확인 후 커밋** — `bun run test:unit client/src/components/Sidebar.test.tsx && bun run typecheck && bun run lint`

```bash
git add client/src/components/Sidebar.tsx client/src/components/Sidebar.test.tsx
git commit -m "feat(crm): 사이드바 팀장 MC 마스터 진입점 — 배지는 admin 전용 유지

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 종합 검증 + PR

- [ ] **Step 1: 서버 무변경 확인** — `git diff --stat main -- src/ supabase/ drizzle/` → **0줄**이어야 한다(클라 전용 PR). 아니면 중단·원인 확인.

- [ ] **Step 2: 전체 게이트** (CI 8단계 중 로컬 해당분 — 서버 무변경이라 실 DB 스위트 불요):

```bash
bun run typecheck && bun run lint && bun run knip && bun run format:check && bun run test:unit && bun run build
```

knip: Task 3의 신규 export 2개가 Task 6·7에서 소비됐으니 0이어야 한다. format:check: `*.test.tsx`·CSS는 포맷 글롭 — 걸리면 `bun run format`.

- [ ] **Step 3: PR 생성**

```bash
git push -u origin feat/catalog-change-approval-manager
gh pr create --title "feat(crm): MC 마스터 변경 승인 — 팀장 개방 (PR 3/3)" --body "$(cat <<'EOF'
## 요약
- **팀장(manager) 편집 개방(spec §7.1)**: canPropose 축 — 기존 편집 UI 그대로, 저장 버튼 "승인 요청", 202 `{queued}`는 catalog.ts 쓰기 헬퍼 8종이 공통 감지(pub/sub) → 토스트 "승인 요청됨 — 관리자 컨펌 후 반영됩니다"(화면 값 불변). 409(타인 pending)는 패널 인라인 에러.
- **행 "승인 대기" 배지(§7.2)**: 모델 단위 pending 조회(admin·manager) → 트림 행 배지(호버 = 요청자·경과·작업) + 트림에 못 붙는 요청은 헤더 pill. 409를 만나기 전 예방선.
- **"내 요청 (N)" 팝오버(§7.3)**: pending 취소·반려 사유 확인·착지 점프. (N) = pending만.
- **사이드바 팀장 진입점 신설**: 종전 팀장 진입점 0(admin 전용 2곳뿐) — 배지는 admin 전용 유지.
- **승인 후 캐시 무효화(브리프 이월 ④)**: invalidateCatalogAfterApproval — 타 모델 30s 스테일 해소.
- 팀장에게 숨김 유지: 삭제·모델 이동·선택 모드(드래그 reorder)·고유번호·딜러 제안 채택·승인 대기열 버튼(기존 테스트가 잠금).

## 서버 변경
**없음** — 202 분기·모델 단위 조회·mine=1·본인 취소 전부 PR 1(#399) 기존재.

## 검증
- typecheck · lint · knip · format:check · test:unit · build 로컬 전량 green
- 신규 테스트: catalog 202 감지 2 · 캐시 무효화 2 · MCMasterPage 팀장 9 · Sidebar 1
- 실기(팀장 요청 → admin 승인 → 반영)는 **PR 1~3 일괄 실기**로 — 유슨생 2026-07-30 결정. 매니저 테스트 계정 = 상담사테스트(role=manager).

계획: `ref/plans/2026-07-30-crm-catalog-change-approval-pr3.md` / spec §7.1~§7.3

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr checks --watch
```

기대: `typecheck · lint · knip · format · unit · pure · build · edge` 8단계 green. **머지는 유슨생 확인 후**(squash — 커밋 메시지 `[skip ci]` 금지 관례).

---

## Self-Review 결과

- **Spec 커버**: §7.1(canPropose·"승인 요청" 라벨·202 공통 처리·409 안내·숨김 목록 — Task 1·4·5) · §7.2(행 배지 + 헤더 pill, admin·manager — Task 3·6) · §7.3(내 요청·취소·반려 사유 — Task 3·7) · 브리프 ④(캐시 무효화 — Task 2, 배선 Task 5-(d)) · 브리프 ⚠️(승인 대기열 버튼 canEdit 유지 — 기존 테스트 :216 GREEN 유지로 잠금).
- **범위 밖 명기**: 모델 목록 행 배지(모델별 N회 조회 필요)·옵션 행 단위 배지(트림 행 배지 title이 대신)·Topbar 설정 팝오버 팀장 개방·HttpError에 requestedBy/requestedAt 태우기(배지가 예방선). 사이드바 팀장 진입점은 브리프 ①~④에 없지만 "팀장 개방"의 전제(진입점 0)라 포함 — PR 본문에 명시해 유슨생 확인.
- **타입 일관**: `canWrite`(Task 5 정의 → 테이블·OptionPanel·배지 enabled에서 사용) · `pendingBadgeByTrim?: Map<number, string>`(Task 6 테이블 2종 동일) · `useMyChangeRequests` 반환 shape(Task 3 정의 = Task 7 소비) · `invalidateCatalogAfterApproval`(Task 2 정의 = Task 5·테스트 beforeEach 소비) · `submitLabel`(Task 4 정의 = Task 5 전달) 확인.
- **주의(구현 시 확인)**: ①Task 5-(b)의 배지 재료 블록은 **Task 6으로 이연**(미사용 변수 lint) — Task 5에서는 토스트 구독만 ②MCMasterPage.test 스텁 신규 분기는 반드시 기존 startsWith 분기들 **위에** ③catalog-cache.test 신규 케이스는 기존 파일의 스텁 관례를 먼저 읽고 동형으로 ④vehicle-admin.css 이웃 룰이 색 토큰을 쓰면 리터럴 대신 토큰.
