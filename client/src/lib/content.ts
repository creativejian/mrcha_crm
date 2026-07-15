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

export const fetchInsights = () => getJson<InsightListItem[]>("/api/insights");
export const fetchInsight = (id: string) => getJson<InsightDetail>(`/api/insights/${id}`);
export const fetchKnowledgeArticles = () => getJson<KnowledgeListItem[]>("/api/knowledge");
export const fetchKnowledgeArticle = (id: string) => getJson<KnowledgeDetail>(`/api/knowledge/${id}`);
