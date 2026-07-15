# CRM 인사이트·지식베이스 읽기 전용 미러 — 구현 플랜

> **For agentic workers:** executing-plans 규율(TDD·bite-sized·frequent commit)로 Task별 실행. 체크박스 추적.

**Goal:** 앱이 관리하는 `public.insights`·`public.knowledge_articles`를 CRM에서 admin 전용 읽기 전용(목록+상세)으로 보여준다. 목업 교체 + 사이드바 진입점.

**Architecture:** 서버는 postgres 롤 read(RLS bypass) — 미러 + 쿼리 + admin 게이트 라우트. 클라는 목록/상세(content 마크다운 `MarkdownMessage` 재사용) + 카테고리 slug→한글 매핑. write·임베딩·Storage 전부 범위 밖.

**Tech Stack:** Hono + drizzle(public-app.ts 미러), React + TS, 기존 admin 게이트 패턴(`isAdmin = roleTab === "최고관리자"`).

**Spec:** `ref/specs/2026-07-15-crm-insights-knowledge-readonly-design.md`

**상세 UI 결정:** 별도 라우트 안 늘리고 **각 페이지 내부 선택 state**로 — 목록에서 행 클릭 시 상세 뷰(content 마크다운 + "목록으로" 버튼), 선택 해제 시 목록.

---

### Task 1: 클라 카테고리 매핑 (TDD)
**Files:** Create `client/src/data/knowledge-categories.ts` + `.test.ts`
- [ ] RED: `knowledgeCategoryLabel("lease")==="리스"`, 미등록 slug는 그대로 반환 테스트
- [ ] GREEN: 앱 `knowledge_categories.dart` 복제 — `KNOWLEDGE_BLOCK_TO_SLUG`(1~12), `KNOWLEDGE_SLUG_TO_LABEL`(spec 표 12장), `knowledgeCategoryLabel(slug) = SLUG_TO_LABEL[slug] ?? slug`
- [ ] `bun run test:unit client/src/data/knowledge-categories.test.ts`
- [ ] Commit

### Task 2: 서버 미러 + 쿼리
**Files:** Modify `src/db/public-app.ts`; Create `src/db/queries/content.ts`
- [ ] `public-app.ts`에 `insights`·`knowledgeArticles` pgTable 미러(embedding 컬럼 제외 — insights: id·title·summary·content·category·status·publishedAt·thumbnailUrl·createdAt·updatedAt; knowledgeArticles: id·category·documentTitle·content·blockNumber·subNumber·status·createdAt·updatedAt)
- [ ] `queries/content.ts`: `listInsights(db)`(메타: content 제외), `getInsight(db,id)`(content·thumbnail 포함), `listKnowledgeArticles(db)`(메타: content 제외, order blockNumber·subNumber), `getKnowledgeArticle(db,id)`(content 포함)
- [ ] `bun run typecheck`
- [ ] Commit

### Task 3: 서버 라우트 (admin 게이트) + 테스트
**Files:** Create `src/routes/content.ts` + `content.test.ts`; Modify `src/app.ts`
- [ ] RED: `content.test.ts` — 실 master read로 `GET /api/insights`(배열·메타 필드), `GET /api/insights/:id`(content 포함), `GET /api/knowledge`(order), `GET /api/knowledge/:id`; **비-admin 403 / admin 200**. (기존 라우트 테스트의 makeTestAuth 패턴 재사용, role 주입)
- [ ] GREEN: `content.ts` — Hono 라우터, 각 핸들러 앞 admin 게이트(`c.var.user.role !== 'admin'` → 403). `app.ts`에 `app.route("/api/content", content)` 또는 `/api/insights`·`/api/knowledge` 개별 등록(실행 시 기존 스타일 확인). 순수 read만.
- [ ] `bun run test:server`(npm 스크립트 프리픽스 필수)
- [ ] Commit

### Task 4: 클라 fetch lib
**Files:** Create `client/src/lib/content.ts`
- [ ] `fetchInsights()`·`fetchInsight(id)`·`fetchKnowledgeArticles()`·`fetchKnowledgeArticle(id)` — 기존 `lib/http` 패턴(인증 헤더 포함) 재사용. 타입은 서버 반환 미러
- [ ] `bun run typecheck`
- [ ] Commit

### Task 5: InsightsPage 실데이터 + 상세
**Files:** Modify `client/src/pages/InsightsPage.tsx`
- [ ] 목업(하드코딩 `insights` 배열·`statusClass`) 제거 → `fetchInsights` 로드(로딩/에러 상태)
- [ ] 목록: 제목·카테고리·status 배지(published=green/draft=기본)·수정일. 등록/편집 버튼 제거
- [ ] 선택 state: 행 클릭 → `fetchInsight(id)` 상세(요약 + content `MarkdownMessage` + 썸네일/본문 이미지 URL 그대로) + "목록으로"
- [ ] `bun run typecheck && bun run lint`
- [ ] Commit

### Task 6: KnowledgeBasePage 실데이터 + 상세
**Files:** Modify `client/src/pages/KnowledgeBasePage.tsx`
- [ ] 목업(`knowledgeGroups`) 제거 → `fetchKnowledgeArticles` 로드, `blockNumber`로 카테고리 그룹핑, 헤더 "N. {knowledgeCategoryLabel(slug)} ({개수})"(앱 형식). 등록 버튼 제거
- [ ] 선택 state: 행 클릭 → `fetchKnowledgeArticle(id)` 상세(document_title + content `MarkdownMessage`) + "목록으로"
- [ ] `bun run typecheck && bun run lint`
- [ ] Commit

### Task 7: admin 게이트 + 사이드바 진입점
**Files:** Modify `client/src/App.tsx`, `client/src/components/Sidebar.tsx`
- [ ] App.tsx: `/insights`·`/knowledge-base` 라우트를 `isAdmin ? <Page/> : <Navigate to="/" replace/>`(finance 패턴)
- [ ] Sidebar: admin일 때만 "인사이트"·"지식베이스" nav 버튼 추가(적절한 그룹 — AI 설정/차량 관리 근처. `insights`/`knowledge` MenuIcon 이미 존재). navigate("insights")/navigate("knowledge-base")
- [ ] `bun run typecheck && bun run lint`
- [ ] Commit

### Task 8: 검증 + 격리 스택 스모크
- [ ] `bun run typecheck && bun run lint && bun run test:unit && bun run test:server && bun run build`; knip 회귀 0
- [ ] 격리 스택 브라우저(admin magiclink): 두 메뉴 노출·목록·카테고리 그룹·상세 마크다운 렌더·비-admin 접근 차단. 실 데이터라 원복 불필요(read only)

## Self-Review
- Spec 커버: 읽기전용=Task2·3 순수 read / 목록+상세=Task5·6 / admin=Task3·7 / 매핑=Task1 / 메뉴=Task7 / 편집버튼 제거=Task5·6. knowledge_chunks·write·임베딩 미포함(범위 밖). ✅
- 타입 일관: `knowledgeCategoryLabel`(T1)=Task6 사용, 서버 미러 필드=쿼리(T2)=fetch(T4)=UI(T5·6) 일치.
- 검증 예산: 서버 `test:server`(실 master read — 알림 테이블 무관, 순수 SELECT라 withNotifyGuard 불요).
