// 앱 콘텐츠(public.insights·knowledge_articles) 읽기 전용 조회 — CRM admin 참조 화면용.
// write·임베딩·knowledge_chunks는 앱 소유(범위 밖). 목록은 메타만(content 제외 — knowledge 111행
// 전문 일괄 로드 방지), 상세(:id)에서만 content를 싣는다.
import { asc, desc, eq } from "drizzle-orm";

import { getDefaultDb, type Executor } from "../client";
import { insights, knowledgeArticles } from "../public-app";

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

export async function listInsights(ex: Executor = getDefaultDb()): Promise<InsightListItem[]> {
  return ex
    .select({
      id: insights.id,
      title: insights.title,
      summary: insights.summary,
      category: insights.category,
      status: insights.status,
      publishedAt: insights.publishedAt,
      updatedAt: insights.updatedAt,
    })
    .from(insights)
    .orderBy(desc(insights.createdAt));
}

export async function getInsight(id: string, ex: Executor = getDefaultDb()): Promise<InsightDetail | null> {
  const [row] = await ex
    .select({
      id: insights.id,
      title: insights.title,
      summary: insights.summary,
      category: insights.category,
      status: insights.status,
      publishedAt: insights.publishedAt,
      updatedAt: insights.updatedAt,
      content: insights.content,
      thumbnailUrl: insights.thumbnailUrl,
    })
    .from(insights)
    .where(eq(insights.id, id))
    .limit(1);
  return row ?? null;
}

export async function listKnowledgeArticles(ex: Executor = getDefaultDb()): Promise<KnowledgeListItem[]> {
  return ex
    .select({
      id: knowledgeArticles.id,
      category: knowledgeArticles.category,
      documentTitle: knowledgeArticles.documentTitle,
      blockNumber: knowledgeArticles.blockNumber,
      subNumber: knowledgeArticles.subNumber,
      updatedAt: knowledgeArticles.updatedAt,
    })
    .from(knowledgeArticles)
    .orderBy(asc(knowledgeArticles.blockNumber), asc(knowledgeArticles.subNumber));
}

export async function getKnowledgeArticle(id: string, ex: Executor = getDefaultDb()): Promise<KnowledgeDetail | null> {
  const [row] = await ex
    .select({
      id: knowledgeArticles.id,
      category: knowledgeArticles.category,
      documentTitle: knowledgeArticles.documentTitle,
      blockNumber: knowledgeArticles.blockNumber,
      subNumber: knowledgeArticles.subNumber,
      updatedAt: knowledgeArticles.updatedAt,
      content: knowledgeArticles.content,
    })
    .from(knowledgeArticles)
    .where(eq(knowledgeArticles.id, id))
    .limit(1);
  return row ?? null;
}
