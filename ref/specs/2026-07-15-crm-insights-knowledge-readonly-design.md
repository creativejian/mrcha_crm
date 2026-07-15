# CRM 인사이트·지식베이스 읽기 전용 미러 — 설계

Last updated: 2026-07-15 (세션 0715-rest-refactoring · 유슨생 · 조사→설계 승인)

## 배경
CRM의 `InsightsPage`·`KnowledgeBasePage`는 하드코딩 목업이고 사이드바 진입점도 없다(라우트·페이지만 존재, URL 직접 접근만). 실 데이터는 앱이 `public` 스키마에 소유·관리한다:
- `public.insights`(4행) — 고객 앱 노출 콘텐츠 + AI 추천 카드. draft/published 2단계.
- `public.knowledge_articles`(111행) — AI 상담 답변 근거(RAG 원문). 12장 카테고리 slug 체계.
- `public.knowledge_chunks`(1221행) — 지식 RAG 임베딩 청크. **CRM 범위 밖**(앱 AI 전용).

앱은 staff/manager/admin이 두 콘텐츠를 CRUD(수정·삭제·발행)한다(화면 게이트 `canAccessAdmin=staffOrAbove`, RLS `for all`). 임베딩은 앱 Edge Function `ai-analyst`(`embed_insight`/`embed_knowledge`)가 담당한다.

## 결정 (유슨생)
1. **읽기 전용** — CRM은 두 콘텐츠를 **보기만** 한다. 작성·수정·삭제·발행·임베딩은 전부 앱이 유지(관리 주체는 앱).
2. **목록 + 상세** — 글 클릭 시 `content` 전문을 마크다운으로(`MarkdownMessage` 재사용). 지식베이스는 content가 본질(AI가 무슨 근거로 답하는지 CRM에서 확인).
3. **admin 전용 게이트** — 앱은 staff 이상이 CRUD하지만, CRM 읽기 전용 참조 화면은 **admin만**(앱보다 좁은 게이트). CRM 기존 admin 라우트 패턴(`finance = isAdmin`) 적용.
4. 목업 "등록/편집" 버튼 제거(읽기 전용).
5. 지식 카테고리 slug→한글 매핑을 앱 `knowledge_categories.dart`에서 CRM으로 미러(고정 12장).

## 데이터 소스 (read only, postgres 롤 — RLS bypass)
### `public.insights`
컬럼: `id`·`title`·`summary`·`content`·`category`(자유 text)·`status`(draft/published)·`published_at`·`thumbnail_url`·`created_at`·`updated_at`·`author_id`(→profiles). **embedding 컬럼은 미러 제외**(CRM 무관).
- CRM은 admin 참조라 draft·published **전체** 조회, status 배지로 구분.
- 정렬: `created_at DESC`(앱과 동일).

### `public.knowledge_articles`
컬럼: `id`·`category`(slug)·`document_title`·`content`·`block_number`·`sub_number`·`status`(항상 published)·`created_at`·`updated_at`.
- 정렬: `block_number, sub_number`(앱과 동일).
- 카테고리 매핑(SSOT = `client/src/data/knowledge-categories.ts`, 앱 `knowledge_categories.dart` 복제):

  | block | slug | 한글 |
  |---|---|---|
  | 1 | identity-role | 차선생의 정체성과 역할 기준 |
  | 2 | purchase-structure | 신차 구매 구조의 기본 이해 |
  | 3 | lump-sum | 일시불 구매 |
  | 4 | installment | 할부 구매 |
  | 5 | lease | 리스 |
  | 6 | long-term-rental | 장기렌트 |
  | 7 | purchase-selection | 구매방식 선택 기준 |
  | 8 | quote-comparison | 견적서 해석과 비교 검증 |
  | 9 | financial-review | 금융 심사와 승인 전략 |
  | 10 | purchase-process | 계약부터 출고까지의 진행 과정 |
  | 11 | dealer-service | 출고 서비스와 딜러 서비스 판단 기준 |
  | 12 | purchase-risk | 자동차 구매 피해와 리스크 방어 |

  미등록 slug는 slug 그대로 노출(앱 `label()` 동작 미러).

## 아키텍처
### 서버
- `src/db/public-app.ts`에 `insights`·`knowledgeArticles` pgTable 미러 추가(기존 quote_requests·advisor_quotes 미러 패턴). embedding 컬럼 제외.
- `src/db/queries/content.ts` 신설 — `listInsights()`(메타만: id·title·summary·category·status·publishedAt·updatedAt), `getInsight(id)`(+content·thumbnail), `listKnowledgeArticles()`(메타: id·category·documentTitle·blockNumber·subNumber·updatedAt), `getKnowledgeArticle(id)`(+content). 목록은 메타, 상세는 content 분리(knowledge 111행 content 전문 일괄 로드 방지).
- `src/routes/content.ts` 신설 — `GET /api/insights`·`GET /api/insights/:id`·`GET /api/knowledge`·`GET /api/knowledge/:id`. **admin 게이트**(기존 admin 미들웨어/패턴 재사용, 비-admin 403).
- 서버는 순수 read — write 라우트 없음.

### 클라
- `client/src/data/knowledge-categories.ts` — slug→한글 매핑 + `knowledgeCategoryLabel(slug)`.
- `client/src/lib/content.ts` — `fetchInsights`·`fetchInsight`·`fetchKnowledgeArticles`·`fetchKnowledgeArticle`.
- `InsightsPage` — 목업 제거, `fetchInsights`로 목록(제목·카테고리·status 배지·날짜). 행 클릭 → 상세(요약 + content 마크다운 + 썸네일/이미지). 등록/편집 버튼 제거.
- `KnowledgeBasePage` — 목업 제거, `fetchKnowledgeArticles`로 카테고리 그룹(block_number 순, "N. 한글라벨 (개수)" 형식) + 행 클릭 → 상세(content 마크다운). 등록 버튼 제거.
- 상세는 목록 내 인라인 확장 or 별도 뷰 — plan에서 확정(간단히 목록에서 선택 시 우측/하단 패널 또는 라우트).
- 사이드바에 진입점 추가: admin 그룹에 "인사이트"·"지식베이스"(현재 라우트·페이지는 있으나 메뉴 없음).

### 게이트
- 라우트(App.tsx): `/insights`·`/knowledge-base`를 `isAdmin` 조건부(비-admin `Navigate to="/"`), `finance` 패턴 미러.
- 서버 라우트: admin 아니면 403.
- 사이드바: admin일 때만 메뉴 노출.

## 인사이트 본문 이미지
`insights.content` 마크다운 내 이미지 URL은 Storage `insight-images` 버킷 render endpoint를 가리킨다. 읽기 전용이라 URL을 그대로 마크다운에 렌더 — 버킷이 공개 read면 표시되고, 접근이 막히면 깨진 이미지(후속 처리). 썸네일(`thumbnail_url`)도 동일.

## 검증
- 서버: `bun run test:server`(실 master read — insights/knowledge_articles 목록·상세, admin 게이트 403).
- 클라: `bun run test:unit`(카테고리 매핑, fetch 파싱).
- typecheck·lint·build.
- 격리 스택 브라우저 스모크: admin으로 두 화면 목록·상세 렌더, 카테고리 그룹, 마크다운 본문, 비-admin 접근 차단.

## 범위 밖 (YAGNI)
- write(작성·수정·삭제·발행) — 앱이 유지.
- 임베딩(`insights.embedding`·`knowledge_chunks`) — 앱 `ai-analyst` Edge 전용.
- `knowledge_chunks` 미러 — CRM AI 무관(CRM 업무 AI는 `crm.embeddings` 별도).
- Storage 이미지 업로드 — 앱 소유.
- staff/manager 접근 — CRM은 admin 전용.

## 앱 팀 몫 (유슨생이 앱에 지시)
- CRM 읽기는 postgres 롤이라 앱 변경 불필요(RLS bypass). 향후 write 도입 시에만 소유권·Edge Function 협의 필요 — 이번 범위 아님.
