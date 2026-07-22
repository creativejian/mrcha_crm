// 공유 master에 남은 테스트 픽스처 잔재를 훑는다. 검사(테스트)와 정리(스크립트)가 같은 쿼리를 본다.
//
// 배경(2026-07-10): `DATABASE_URL`이 공유 master라 테스트는 진짜 고객·견적 행을 만든다.
// 정상 종료하면 `afterAll`이 지우지만 **실행이 중간에 끊기면 행이 그대로 남는다.**
// `CU-EMBRT-…/배선테스트`가 2026-07-09에 남아 이사님 고객 목록에 유령으로 떴다 — 사람 눈이 발견했다.
import { sql } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  prefixRegex, TEST_CONSULTATION_NAMES, TEST_CUSTOMER_CODE_PREFIXES, TEST_CUSTOMER_NAMES, TEST_QUOTE_CODE_PREFIXES,
} from "./fixture-codes";

export const CUSTOMER_CODE_REGEX = prefixRegex(TEST_CUSTOMER_CODE_PREFIXES);
export const QUOTE_CODE_REGEX = prefixRegex(TEST_QUOTE_CODE_PREFIXES);
const CONSULTATION_NAME_REGEX = prefixRegex(TEST_CONSULTATION_NAMES);

// 고객 잔재 판정 — 코드 접두사 or 등록된 픽스처 이름. 실채번 픽스처(POST 라우트 테스트)는
// 코드가 CU-YYMM-####라 접두사로 못 잡는다 — 이름이 잡는다. scan과 check-test-residue --clean이 공유.
// 이름 registry가 비면 이름 절을 통째로 생략한다 — `name in ()`은 SQL 문법 오류라 스캔 전체가 죽는다.
export function customerResidueWhere() {
  if (TEST_CUSTOMER_NAMES.length === 0) return sql`customer_code ~ ${CUSTOMER_CODE_REGEX}`;
  const names = sql.join(TEST_CUSTOMER_NAMES.map((n) => sql`${n}`), sql`, `);
  return sql`(customer_code ~ ${CUSTOMER_CODE_REGEX} or name in (${names}))`;
}

export type FixtureResidue = {
  customers: { customerCode: string; name: string; createdAt: string }[];
  quotes: { quoteCode: string }[];
  /** 고객이 없는 crm.embeddings — FK CASCADE가 막지만 백필/psql 우회로 생길 수 있다. */
  orphanEmbeddings: number;
  /** crm.quotes에 없는 public.advisor_quotes — **앱 화면의 유령 견적 카드**. */
  orphanAppCards: number;
  /**
   * public.consultations 픽스처 잔재(원미래 created_at 또는 registry 이름) — **report-only**.
   * 앱 소유 스키마라 `--clean`이 지우지 않는다. 잔재는 고객 상세 문의 카드·업무 AI 도구·AI 힌트
   * 재료를 점유하므로 수동 psql DELETE로 정리한다(DELETE는 알림 트리거 무관 — INSERT만 발화).
   */
  consultations: { id: string; customerName: string; createdAt: string }[];
  /** crm.customer_deletions 감사 잔재 — 고객 행이 이미 없어도 남는다. `--clean`이 같은 술어로 지운다. */
  deletionAudits: { customerCode: string; name: string }[];
};

export function residueCount(r: FixtureResidue): number {
  return (
    r.customers.length + r.quotes.length + r.orphanEmbeddings + r.orphanAppCards +
    r.consultations.length + r.deletionAudits.length
  );
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
  // 앱 소유 read-only 스캔 — 원미래(2126 픽스처) created_at 또는 registry 이름 접두사만 잔재로 본다.
  const consultations = await asRows<{ id: string; customer_name: string; created_at: string }>(sql`
    select id::text, customer_name, created_at::text from public.consultations
    where created_at > now() or customer_name ~ ${CONSULTATION_NAME_REGEX} order by created_at`);
  // 감사 행은 고객 행이 삭제된 뒤에도 남는다 — customer_deletions에 code·name이 스냅샷돼 있어
  // customerResidueWhere()(코드 정규식 + 이름 registry)를 그대로 재사용한다(--clean과 동일 술어).
  const deletionAudits = await asRows<{ customer_code: string; name: string }>(sql`
    select customer_code, name from crm.customer_deletions where ${customerResidueWhere()} order by deleted_at`);

  return {
    customers: customers.map((c) => ({ customerCode: c.customer_code, name: c.name, createdAt: c.created_at })),
    quotes: quotes.map((q) => ({ quoteCode: q.quote_code })),
    orphanEmbeddings: Number(emb?.n ?? 0),
    orphanAppCards: Number(cards?.n ?? 0),
    consultations: consultations.map((c) => ({ id: c.id, customerName: c.customer_name, createdAt: c.created_at })),
    deletionAudits: deletionAudits.map((d) => ({ customerCode: d.customer_code, name: d.name })),
  };
}

export function formatResidue(r: FixtureResidue): string {
  const lines: string[] = [];
  for (const c of r.customers) lines.push(`고객 ${c.customerCode} · ${c.name} · ${c.createdAt}`);
  for (const q of r.quotes) lines.push(`견적 ${q.quoteCode}`);
  if (r.orphanEmbeddings > 0) lines.push(`고아 임베딩 ${r.orphanEmbeddings}건 (고객 없는 crm.embeddings)`);
  if (r.orphanAppCards > 0) lines.push(`고아 앱 카드 ${r.orphanAppCards}건 — 앱 화면의 유령 견적`);
  for (const c of r.consultations) {
    lines.push(`상담신청 ${c.customerName} · ${c.createdAt} — public 소유, --clean 미삭제(수동 psql DELETE)`);
  }
  for (const d of r.deletionAudits) lines.push(`삭제 감사 ${d.customerCode} · ${d.name} (crm.customer_deletions)`);
  return lines.join("\n");
}
