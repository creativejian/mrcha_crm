// 공유 master에 남은 테스트 픽스처 잔재를 훑는다. 검사(테스트)와 정리(스크립트)가 같은 쿼리를 본다.
//
// 배경(2026-07-10): `DATABASE_URL`이 공유 master라 테스트는 진짜 고객·견적 행을 만든다.
// 정상 종료하면 `afterAll`이 지우지만 **실행이 중간에 끊기면 행이 그대로 남는다.**
// `CU-EMBRT-…/배선테스트`가 2026-07-09에 남아 이사님 고객 목록에 유령으로 떴다 — 사람 눈이 발견했다.
import { sql } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  prefixRegex, TEST_APP_PROFILE_NAMES, TEST_CONSULTATION_NAMES, TEST_CUSTOMER_CODE_PREFIXES, TEST_CUSTOMER_NAMES,
  TEST_QUOTE_CODE_PREFIXES,
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
  /**
   * public.quote_requests 픽스처 잔재(2026-08-07) — **report-only**(앱 소유라 `--clean` 대상 아님).
   * 진행 단계 전이 테스트가 전용 `상담사테스트` profile 앞으로 만드는 요청 행이다. 그 테이블엔 코드
   * 컬럼이 없어 접두사 registry로는 못 잡고, `listQuoteRequests`는 **필터 없는 전역 인박스**라
   * 잔재가 모든 스태프에게 유령 견적요청 카드로 뜬다(2026-07-09 `CU-EMBRT-…`와 같은 실패 방식).
   */
  quoteRequests: { id: string; status: string; createdAt: string }[];
  /** crm.customer_deletions 감사 잔재 — 고객 행이 이미 없어도 남는다. `--clean`이 같은 술어로 지운다. */
  deletionAudits: { customerCode: string; name: string }[];
  /**
   * crm.account_deletion_jobs 잔재(2026-08-02) — 라우트 테스트가 **커밋**한 잡이 실행 중단 시 남고,
   * received 잡은 leftJoin 목록이라 **스태프 목록 상단 "회원탈퇴 확인 대기 N건" 알림에 유령으로
   * 계속 뜬다**(고객 행을 지워도 잡은 loose id라 남는다 — 07-09 유령 고객 사건과 동형).
   * 판정 = customer_code 접두사. ⚠️ 미연결 유저 잡(customer_code NULL)은 실 탈퇴 감사 잡과 서명이
   * 같아 기계 판별이 불가능하다(딜러 3테이블 주석과 같은 한계) — 라우트 finally 정리에 의존.
   */
  deletionJobs: { customerCode: string; status: string }[];
  /** 픽스처 잡에 매달린 crm.settlement_references — `--clean`이 잡보다 먼저 지운다(loose id). */
  fixtureSettlements: number;
  /**
   * 딜러 3테이블의 잔재 — 판별식이 고객과 다르다. PK/FK가 uuid라 **코드 리터럴 registry로는
   * 탐지할 수 없어서**(`fixture-codes.ts`가 CU-/QT-/PUSH- 접두사만 본다) 딜러 테스트는 스스로
   * "잔재를 탐지할 수 없다"고 주석에 적어둔 채 그물 밖에 있었다(2026-07-27 실측: 고아 제안 1행이
   * 실제로 남아 있었고 `check:residue`는 "잔재 없음"이라고 답했다).
   *
   * 대신 **고아 판정**을 쓴다: 실제 딜러·관리자는 앱 유저라 반드시 `public.profiles`에 있고,
   * 테스트는 `crypto.randomUUID()`를 쓰므로 절대 없다. 사람 유저가 앱에서 탈퇴해도 잡히는데,
   * 그건 오탐이 아니다 — 없는 유저의 딜러 매칭·제안은 어차피 정리 대상이다.
   */
  orphanDealerProfiles: { dealerUserId: string; brandId: number }[];
  orphanDealerDiscounts: { dealerUserId: string; trimId: number }[];
  /**
   * 고아 채택 감사 — **report-only**(`--clean`이 지우지 않는다).
   * 다른 잔재와 성격이 다르다: 이 행이 남았다는 건 **`catalog.trims`의 확정 할인이 테스트 값으로
   * 오염됐을 수 있다**는 뜻이고(앱 고객에게 보이는 금액이다), 되돌릴 유일한 근거가 이 행의
   * `previous_amount`다. 먼저 지우면 복원 정보가 사라진다 — 그래서 되돌리기 SQL을 안내만 한다.
   */
  orphanAdoptions: { trimId: number; field: string; previousAmount: number | null; adoptedAt: string }[];
  /**
   * 고아 변경 요청 — profiles에 없는 requested_by(테스트 uuid). pending/rejected/canceled는
   * 미반영 큐 행이라 `--clean`이 지우지만, **approved는 report-only** — 승인 replay가 catalog에
   * 이미 반영된 변경의 감사 기록이고 snapshot이 복원의 유일한 단서다(orphanAdoptions와 같은 결).
   */
  orphanChangeRequests: { id: string; kind: string; status: string }[];
};

// 채택 필드 → catalog.trims 컬럼. 되돌리기 SQL 안내에 쓴다(형식은 client/src/lib/discount-adoption.ts의
// ProposalState와 같은 3필드 어휘 — 여기서 하드코딩하는 이유는 SQL 컬럼명이 클라에 없기 때문이다).
const ADOPTION_FIELD_COLUMNS: Record<string, string> = {
  financial: "financial_discount_amount",
  partner: "partner_discount_amount",
  cash: "cash_discount_amount",
};

export function residueCount(r: FixtureResidue): number {
  return (
    r.customers.length + r.quotes.length + r.orphanEmbeddings + r.orphanAppCards +
    r.consultations.length + r.quoteRequests.length + r.deletionAudits.length +
    r.deletionJobs.length + r.fixtureSettlements +
    r.orphanDealerProfiles.length + r.orphanDealerDiscounts.length + r.orphanAdoptions.length +
    r.orphanChangeRequests.length
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
  // 앱 소유 read-only 스캔 — 전용 테스트 profile 앞으로 만들어진 요청만 잔재로 본다(위 타입 주석 참조).
  // registry가 비면 절을 통째로 생략한다(`in ()`은 SQL 문법 오류 — customerResidueWhere와 같은 방어).
  const quoteRequests = TEST_APP_PROFILE_NAMES.length === 0 ? [] : await asRows<{ id: string; status: string; created_at: string }>(sql`
    select id::text, status, created_at::text from public.quote_requests
    where user_id in (select id from public.profiles where full_name in (${sql.join(TEST_APP_PROFILE_NAMES.map((n) => sql`${n}`), sql`, `)}))
    order by created_at`);
  // 감사 행은 고객 행이 삭제된 뒤에도 남는다 — customer_deletions에 code·name이 스냅샷돼 있어
  // customerResidueWhere()(코드 정규식 + 이름 registry)를 그대로 재사용한다(--clean과 동일 술어).
  const deletionAudits = await asRows<{ customer_code: string; name: string }>(sql`
    select customer_code, name from crm.customer_deletions where ${customerResidueWhere()} order by deleted_at`);
  // 탈퇴 잡·정산 참조(2026-08-02) — 잡은 코드 접두사, 정산은 픽스처 잡 연결(loose id join)로 판정.
  const deletionJobs = await asRows<{ customer_code: string; status: string }>(sql`
    select customer_code, status from crm.account_deletion_jobs
    where customer_code ~ ${CUSTOMER_CODE_REGEX} order by requested_at`);
  const [fixtureSettlements] = await asRows<{ n: number }>(sql`
    select count(*)::int as n from crm.settlement_references s
    where s.deletion_job_id in (select id from crm.account_deletion_jobs where customer_code ~ ${CUSTOMER_CODE_REGEX})`);
  // 딜러 3테이블 — 고아 판정(위 타입 주석 참조). profiles는 **읽기만** 한다(계약 준수).
  const orphanDealerProfiles = await asRows<{ dealer_user_id: string; brand_id: number }>(sql`
    select dp.dealer_user_id::text, dp.brand_id from crm.dealer_profiles dp
    where not exists (select 1 from public.profiles p where p.id = dp.dealer_user_id)
    order by dp.created_at`);
  const orphanDealerDiscounts = await asRows<{ dealer_user_id: string; trim_id: number }>(sql`
    select d.dealer_user_id::text, d.trim_id from crm.dealer_trim_discounts d
    where not exists (select 1 from public.profiles p where p.id = d.dealer_user_id)
    order by d.created_at`);
  const orphanAdoptions = await asRows<{
    trim_id: number; field: string; previous_amount: number | null; adopted_at: string;
  }>(sql`
    select a.trim_id, a.field, a.previous_amount, a.adopted_at::text from crm.catalog_discount_adoptions a
    where not exists (select 1 from public.profiles p where p.id = a.adopted_by)
    order by a.adopted_at`);
  // 변경 요청 큐 — 라우트 테스트의 requested_by가 랜덤 uuid라 고아 판정으로 잡는다(딜러 3테이블과
  // 같은 이유: uuid PK/FK라 코드 리터럴 registry로는 탐지 불가). status 무관 전수 — canceled도 잔재다.
  // 탐지는 전수, 삭제는 approved 제외(check-test-residue.ts 참조).
  const orphanChangeRequests = await asRows<{ id: string; kind: string; status: string }>(sql`
    select r.id::text, r.kind, r.status from crm.catalog_change_requests r
    where not exists (select 1 from public.profiles p where p.id = r.requested_by)
    order by r.created_at`);

  return {
    customers: customers.map((c) => ({ customerCode: c.customer_code, name: c.name, createdAt: c.created_at })),
    quotes: quotes.map((q) => ({ quoteCode: q.quote_code })),
    orphanEmbeddings: Number(emb?.n ?? 0),
    orphanAppCards: Number(cards?.n ?? 0),
    consultations: consultations.map((c) => ({ id: c.id, customerName: c.customer_name, createdAt: c.created_at })),
    // status는 nullable 컬럼이라 표시용 폴백을 둔다(보고 줄에서 undefined가 되지 않게).
    quoteRequests: quoteRequests.map((q) => ({ id: q.id, status: q.status ?? "(null)", createdAt: q.created_at })),
    deletionAudits: deletionAudits.map((d) => ({ customerCode: d.customer_code, name: d.name })),
    deletionJobs: deletionJobs.map((j) => ({ customerCode: j.customer_code, status: j.status })),
    fixtureSettlements: Number(fixtureSettlements?.n ?? 0),
    orphanDealerProfiles: orphanDealerProfiles.map((d) => ({
      dealerUserId: d.dealer_user_id, brandId: Number(d.brand_id),
    })),
    orphanDealerDiscounts: orphanDealerDiscounts.map((d) => ({
      dealerUserId: d.dealer_user_id, trimId: Number(d.trim_id),
    })),
    orphanAdoptions: orphanAdoptions.map((a) => ({
      trimId: Number(a.trim_id),
      field: a.field,
      previousAmount: a.previous_amount === null ? null : Number(a.previous_amount),
      adoptedAt: a.adopted_at,
    })),
    orphanChangeRequests: orphanChangeRequests.map((cr) => ({ id: cr.id, kind: cr.kind, status: cr.status })),
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
  for (const q of r.quoteRequests) {
    lines.push(`견적요청 ${q.id} · ${q.status} · ${q.createdAt} — 전역 인박스 유령 카드, public 소유·--clean 미삭제(수동 psql DELETE)`);
  }
  for (const d of r.deletionAudits) lines.push(`삭제 감사 ${d.customerCode} · ${d.name} (crm.customer_deletions)`);
  for (const j of r.deletionJobs) {
    const ghost = j.status === "received" ? " — ⚠️ 스태프 목록 '탈퇴 확인 대기' 알림에 유령으로 뜹니다" : "";
    lines.push(`탈퇴 잡 ${j.customerCode} · ${j.status} (crm.account_deletion_jobs)${ghost}`);
  }
  if (r.fixtureSettlements > 0) lines.push(`정산 참조 ${r.fixtureSettlements}건 (crm.settlement_references — 픽스처 잡 연결)`);
  for (const d of r.orphanDealerProfiles) {
    lines.push(`딜러 매칭 ${d.dealerUserId} · 브랜드 ${d.brandId} (crm.dealer_profiles — profiles에 없는 유저)`);
  }
  for (const d of r.orphanDealerDiscounts) {
    lines.push(`딜러 제안 ${d.dealerUserId} · 트림 ${d.trimId} (crm.dealer_trim_discounts — profiles에 없는 유저)`);
  }
  for (const a of r.orphanAdoptions) {
    lines.push(
      `채택 감사 트림 ${a.trimId} · ${a.field} · ${a.adoptedAt} — **catalog.trims 확정 할인이 오염됐을 수 있습니다**(앱 고객에게 보이는 금액)`,
    );
  }
  if (r.orphanAdoptions.length > 0) lines.push("", ...restoreAdoptionSql(r.orphanAdoptions));
  for (const cr of r.orphanChangeRequests) {
    const approvedNote = cr.status === "approved"
      ? " — ⚠️ 반영된 변경의 감사 기록, --clean 미삭제(snapshot이 복원 단서)"
      : "";
    lines.push(`변경 요청 ${cr.id} · ${cr.kind} · ${cr.status} (crm.catalog_change_requests — profiles에 없는 요청자)${approvedNote}`);
  }
  return lines.join("\n");
}

// 고아 채택으로 오염된 확정 할인을 되돌리는 SQL을 만든다(실행하지 않고 **안내만** 한다 —
// catalog는 앱 소유 데이터고, 사람이 값을 보고 판단해야 한다).
// 같은 (트림, 필드)가 여러 번 채택됐으면 **가장 오래된** previous_amount가 진짜 원본이다 —
// 두 번째 채택의 previous_amount는 이미 첫 채택이 넣은 테스트 값이다. 입력이 adopted_at 순이므로
// 먼저 온 것만 남긴다.
export function restoreAdoptionSql(rows: FixtureResidue["orphanAdoptions"]): string[] {
  const oldest = new Map<string, FixtureResidue["orphanAdoptions"][number]>();
  for (const a of rows) {
    const key = `${a.trimId}:${a.field}`;
    if (!oldest.has(key)) oldest.set(key, a);
  }
  const out = ["  되돌리기(값을 눈으로 확인한 뒤 psql로 실행하세요 — 자동 삭제하지 않습니다):"];
  for (const a of oldest.values()) {
    const column = ADOPTION_FIELD_COLUMNS[a.field];
    if (!column) {
      out.push(`  -- ⚠️ 알 수 없는 field '${a.field}' (트림 ${a.trimId}) — 수동 확인 필요`);
      continue;
    }
    out.push(
      `  update catalog.trims set ${column} = ${a.previousAmount ?? "null"} where id = ${a.trimId};`,
    );
  }
  out.push("  -- 되돌린 뒤: delete from crm.catalog_discount_adoptions where adopted_by not in (select id from public.profiles);");
  return out;
}
