// 고객 하드 삭제(2026-07-10). spec: ref/specs/2026-07-10-crm-customer-delete-design.md
// 해체 코어는 회원탈퇴 실행 경로(account-deletion.ts, 2026-08-01)와 공유한다 — 가드·감사만 다르다.
//
// 별도 모듈인 이유: queries/customers.ts ← customer-quotes.ts(getCustomerAppUserId) 의존이 이미 있어
// 반대 방향(customers → deleteQuote)을 더하면 순환이 된다. 양쪽을 소비하는 이 파일이 경계다.
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { ConflictError } from "../../lib/errors";
import { getDefaultDb, type Executor } from "../client";
import { advisorQuotes } from "../public-app";
import { customerDeletions, customerDocuments, customers, quotes } from "../schema";
import { purgeAssistantMessagesForCustomer } from "./assistant-messages";
import { deleteQuote } from "./customer-quotes";

export type CustomerDeleteResult = {
  id: string;
  /** 커밋 후 지울 Storage 객체 경로 — 트랜잭션 안에서 미리 모은다(CASCADE로 행이 사라지면 알 수 없다). */
  storagePaths: string[];
};

export type PurgedCustomer = CustomerDeleteResult & {
  customerCode: string;
  appUserId: string | null;
  quoteCount: number;
};

// 해체 코어 — 가드·감사 없이 고객 1명을 물리 해체한다(Storage 경로 수집 → 견적 해체 → 행 삭제).
// 감사 행(customer_deletions)은 호출자 책임: 스태프 경로(deleteCustomer)와 탈퇴 경로
// (account-deletion.ts)가 각자 기록한다. 반드시 트랜잭션 안에서 호출한다.
export async function purgeCustomerCore(customerId: string, ex: Executor): Promise<PurgedCustomer | null> {
  const [target] = await ex
    .select({ id: customers.id, customerCode: customers.customerCode, appUserId: customers.appUserId })
    .from(customers)
    .where(eq(customers.id, customerId));
  if (!target) return null;

  // ── Storage 경로 수집 (삭제 전에) ────────────────────────────────
  const docs = await ex
    .select({ filePath: customerDocuments.filePath, thumbPath: customerDocuments.thumbPath })
    .from(customerDocuments)
    .where(eq(customerDocuments.customerId, customerId));
  const quoteRows = await ex
    .select({ id: quotes.id, filePath: quotes.filePath })
    .from(quotes)
    .where(eq(quotes.customerId, customerId));
  const storagePaths = [
    ...docs.flatMap((d) => [d.filePath, d.thumbPath]),
    ...quoteRows.map((q) => q.filePath),
  ].filter((p): p is string => !!p);

  // ── 견적 해체 (crm.quotes FK는 NO ACTION — 코드가 먼저 치운다) ────
  // 일괄 DELETE가 아니라 deleteQuote()를 견적당 호출한다. 카드 회수·요청 open 복원까지
  // deleteQuote()가 견적 해체의 SSOT이므로 그대로 쓴다 — 고객당 견적은 한 자릿수라 성능 논거가 없다.
  for (const q of quoteRows) await deleteQuote(customerId, q.id, ex);

  // 업무 AI 대화 중 이 고객을 다룬 턴(provenance, 2026-08-04) — CASCADE가 닿지 않는다
  // (assistant_messages는 고객이 아니라 직원 소유라 FK가 없다). 임베딩만 지우고 대화를 남기면
  // "업무 AI가 이 고객을 완전히 잊는다"가 반쪽이 된다 — 코퍼스에선 사라졌는데 지난 답변에는
  // 이름·연락처가 그대로 남는다. 회원탈퇴 회신 §7의 "탈퇴·파기 시 관련 turn 삭제"가 이 줄이고,
  // 스태프 하드 삭제(#212)도 같은 파기라 같은 규칙을 받는다.
  // ⚠️ provenance 도입 전 과거 행(배열 NULL)과 질문 텍스트에만 이름이 나온 턴은 못 잡는다 —
  // 그 잔여는 30일 rolling(cron/assistant-retention-cron.ts)이 상한으로 막는다.
  await purgeAssistantMessagesForCustomer(customerId, ex);

  // 자식 7종(메모·할일·일정·서류·상담·임베딩·출고 정보)은 FK CASCADE가 지운다.
  // 임베딩까지 함께 사라져야 업무 AI가 이 고객을 완전히 잊는다 — 테스트가 잠근다.
  await ex.delete(customers).where(eq(customers.id, customerId));

  return { id: target.id, customerCode: target.customerCode, appUserId: target.appUserId, quoteCount: quoteRows.length, storagePaths };
}

// 스태프 경로(#212). 반드시 트랜잭션 안에서 호출한다(라우트가 감싼다).
//
// 앱 카드 가드의 경합 한계(0713 감사 정정): 가드는 잠금 없는 SELECT라 READ COMMITTED에서 트랜잭션
// 배치만으로는 "가드 통과 ↔ 커밋" 사이 다른 세션의 발송 커밋을 막지 못한다. 유령 카드를 실제로 막는
// 방벽은 ①발송 경로가 같은 트랜잭션에서 quotes 행 UPDATE를 선행해 위 deleteQuote의 행 잠금과
// 직렬화되고 ②새치기 카드는 deleteQuote의 카드 회수로 수렴한다는 것. 남는 실피해는 "카드 보유 고객이
// 409 대신 조용히 삭제되며 카드가 회수되는" 정책 우회 창(ms)뿐 — admin 전용 드문 조작이라 수용.
export async function deleteCustomer(
  customerId: string,
  deletedBy: string,
  ex: Executor = getDefaultDb(),
): Promise<CustomerDeleteResult | null> {
  // ── 가드: 앱에 발송한 견적 카드가 있으면 삭제하지 않는다 ──────────────
  // 고객 삭제가 앱 카드를 조용히 연쇄 삭제하는 것을 막는다(2026-07-10 이사님 결정).
  // 상담사가 "이 견적을 지운다"고 누르는 건 의도한 행동의 직접 결과이므로 그 경로(deleteQuote)는 그대로 둔다.
  // 지우려면 견적함에서 견적을 먼저 삭제해 카드를 회수하는 명시적 2단계를 밟는다.
  // (회원탈퇴 실행 경로는 이 가드를 타지 않는다 — 탈퇴에선 카드 회수가 의도 그 자체, 2026-08-01 회신 §2.)
  const [{ cards }] = await ex
    .select({ cards: sql<number>`count(*)::int` })
    .from(advisorQuotes)
    .innerJoin(quotes, eq(quotes.id, advisorQuotes.crmQuoteId))
    .where(eq(quotes.customerId, customerId));
  if (cards > 0) {
    throw new ConflictError(
      `앱으로 발송한 견적이 ${cards}건 있습니다. 먼저 견적을 회수하거나 진행 상태를 '불발'로 바꾸세요.`,
    );
  }

  const purged = await purgeCustomerCore(customerId, ex);
  if (!purged) return null;

  // 감사 행 — name·app_user_id는 기록하지 않는다(2026-08-01 회신 §6 전체 익명화 결정과 정합:
  // 기존 행을 익명화 backfill하면서 새 행이 다시 이름을 쌓으면 결정이 무의미해진다.
  // "누가·언제·무엇을"은 customer_code·deleted_by·deleted_at으로 성립).
  await ex.insert(customerDeletions).values({
    customerId: purged.id,
    customerCode: purged.customerCode,
    quoteCount: purged.quoteCount,
    deletedBy,
  });

  return { id: purged.id, storagePaths: purged.storagePaths };
}

// 견적 1건 삭제 시 원본 파일 경로(기존 결함 수정 — 서류 삭제는 지우는데 견적 삭제는 안 지웠다).
export async function quoteStoragePath(
  customerId: string,
  quoteId: string,
  ex: Executor = getDefaultDb(),
): Promise<string | null> {
  const [row] = await ex
    .select({ filePath: quotes.filePath })
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.customerId, customerId), isNotNull(quotes.filePath)));
  return row?.filePath ?? null;
}
