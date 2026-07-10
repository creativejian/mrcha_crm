// 공유 master에 남은 테스트 픽스처 잔재를 훑는다. 검사(테스트)와 정리(스크립트)가 같은 쿼리를 본다.
//
// 배경(2026-07-10): `DATABASE_URL`이 공유 master라 테스트는 진짜 고객·견적 행을 만든다.
// 정상 종료하면 `afterAll`이 지우지만 **실행이 중간에 끊기면 행이 그대로 남는다.**
// `CU-EMBRT-…/배선테스트`가 2026-07-09에 남아 이사님 고객 목록에 유령으로 떴다 — 사람 눈이 발견했다.
import { sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { prefixRegex, TEST_CUSTOMER_CODE_PREFIXES, TEST_CUSTOMER_NAMES, TEST_QUOTE_CODE_PREFIXES } from "./fixture-codes";

export const CUSTOMER_CODE_REGEX = prefixRegex(TEST_CUSTOMER_CODE_PREFIXES);
export const QUOTE_CODE_REGEX = prefixRegex(TEST_QUOTE_CODE_PREFIXES);

// 고객 잔재 판정 — 코드 접두사 or 등록된 픽스처 이름. 실채번 픽스처(POST 라우트 테스트)는
// 코드가 CU-YYMM-####라 접두사로 못 잡는다 — 이름이 잡는다. scan과 check-test-residue --clean이 공유.
export function customerResidueWhere() {
  const names = sql.join(TEST_CUSTOMER_NAMES.map((n) => sql`${n}`), sql`, `);
  return sql`customer_code ~ ${CUSTOMER_CODE_REGEX} or name in (${names})`;
}

export type FixtureResidue = {
  customers: { customerCode: string; name: string; createdAt: string }[];
  quotes: { quoteCode: string }[];
  /** 고객이 없는 crm.embeddings — FK CASCADE가 막지만 백필/psql 우회로 생길 수 있다. */
  orphanEmbeddings: number;
  /** crm.quotes에 없는 public.advisor_quotes — **앱 화면의 유령 견적 카드**. */
  orphanAppCards: number;
};

export function residueCount(r: FixtureResidue): number {
  return r.customers.length + r.quotes.length + r.orphanEmbeddings + r.orphanAppCards;
}

export async function scanFixtureResidue(db: Db): Promise<FixtureResidue> {
  const asRows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)) as unknown as T[];

  const customers = await asRows<{ customer_code: string; name: string; created_at: string }>(sql`
    select customer_code, name, created_at::text from crm.customers
    where ${customerResidueWhere()} order by created_at`);
  const quotes = await asRows<{ quote_code: string }>(sql`
    select quote_code from crm.quotes where quote_code ~ ${QUOTE_CODE_REGEX} order by created_at`);
  const [emb] = await asRows<{ n: number }>(sql`
    select count(*)::int as n from crm.embeddings e
    where not exists (select 1 from crm.customers c where c.id = e.customer_id)`);
  const [cards] = await asRows<{ n: number }>(sql`
    select count(*)::int as n from public.advisor_quotes a
    where not exists (select 1 from crm.quotes q where q.id = a.crm_quote_id)`);

  return {
    customers: customers.map((c) => ({ customerCode: c.customer_code, name: c.name, createdAt: c.created_at })),
    quotes: quotes.map((q) => ({ quoteCode: q.quote_code })),
    orphanEmbeddings: Number(emb?.n ?? 0),
    orphanAppCards: Number(cards?.n ?? 0),
  };
}

export function formatResidue(r: FixtureResidue): string {
  const lines: string[] = [];
  for (const c of r.customers) lines.push(`고객 ${c.customerCode} · ${c.name} · ${c.createdAt}`);
  for (const q of r.quotes) lines.push(`견적 ${q.quoteCode}`);
  if (r.orphanEmbeddings > 0) lines.push(`고아 임베딩 ${r.orphanEmbeddings}건 (고객 없는 crm.embeddings)`);
  if (r.orphanAppCards > 0) lines.push(`고아 앱 카드 ${r.orphanAppCards}건 — 앱 화면의 유령 견적`);
  return lines.join("\n");
}
