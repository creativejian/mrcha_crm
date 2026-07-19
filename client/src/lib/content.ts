// 앱 콘텐츠(인사이트·지식베이스) 읽기 전용 fetch. admin 전용 라우트(비-admin 403).
// 타입은 서버 src/db/queries/content.ts 반환 미러(클라는 서버 모듈을 import하지 않음 — 부작용 경계).
import { getJson } from "./http";

export type InsightListItem = {
  id: string;
  title: string;
  summary: string;
  category: string;
  status: string;
  publishedAt: string | null;
  updatedAt: string | null;
};

export type InsightDetail = InsightListItem & {
  content: string;
  thumbnailUrl: string | null;
};

export type KnowledgeListItem = {
  id: string;
  category: string;
  documentTitle: string;
  blockNumber: number | null;
  subNumber: number | null;
  updatedAt: string | null;
};

export type KnowledgeDetail = KnowledgeListItem & {
  content: string;
};

// 콘텐츠 목록/상세 날짜 표시 1벌 — 인사이트·지식베이스가 연도 자릿수(4/2자리)로 갈리던 드리프트 해소.
export function formatContentDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// TTL 캐시 + in-flight dedupe(quote-requests needsCache 미러) — 매 진입 콜드 fetch가 목록/상세 로딩
// 체감 지연의 원인이었다. 앱 소유 콘텐츠라 CRM 세션 중 변경이 드물어 TTL 5분(앱이 발행한 신규 글은
// 최대 5분 후·또는 F5로 반영 — 모듈 스코프라 새로고침 시 자연 초기화). 실패는 캐시하지 않는다.
const CONTENT_TTL_MS = 5 * 60_000;
const contentCache = new Map<string, { value: unknown; at: number }>();
const contentInflight = new Map<string, Promise<unknown>>();

function cachedJson<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = contentCache.get(key);
  if (hit && Date.now() - hit.at < CONTENT_TTL_MS) return Promise.resolve(hit.value as T);
  const existing = contentInflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = load()
    .then((value) => {
      contentCache.set(key, { value, at: Date.now() });
      return value;
    })
    .finally(() => {
      if (contentInflight.get(key) === p) contentInflight.delete(key);
    });
  contentInflight.set(key, p);
  return p;
}

export const fetchInsights = () => cachedJson("insights", () => getJson<InsightListItem[]>("/api/insights"));
export const fetchInsight = (id: string) => cachedJson(`insight:${id}`, () => getJson<InsightDetail>(`/api/insights/${id}`));
export const fetchKnowledgeArticles = () => cachedJson("knowledge", () => getJson<KnowledgeListItem[]>("/api/knowledge"));
export const fetchKnowledgeArticle = (id: string) => cachedJson(`knowledge:${id}`, () => getJson<KnowledgeDetail>(`/api/knowledge/${id}`));
