import { eq } from "drizzle-orm";

import { initialCustomers } from "../client/src/data/customers";
import { getDefaultDb } from "../src/db/client";
import { customerDocuments, customerMemos, customers, customerSchedules, customerTasks, quotes, quoteScenarios } from "../src/db/schema";

// "2026-05-14 12:56"(절대) | "오늘 13:04" | "어제 19:10" | "5/10 16:30" 파싱.
// 기준일: 목업 최신 절대 시각(2026-05-14)을 "오늘"로 본다(결정적, Date.now 미사용).
const TODAY = "2026-05-14";
const YESTERDAY = "2026-05-13";
const YEAR = "2026";

// timestamptz 컬럼은 drizzle 기본 mode 'date' → Date 객체로 넣는다.
function toTimestamp(s: string): Date | null {
  if (!s) return null;
  const m = s.trim();
  // 절대: "2026-05-14 12:56"
  if (/^\d{4}-\d{2}-\d{2}/.test(m)) return new Date(`${m.replace(" ", "T")}:00+09:00`);
  // "오늘 HH:mm" / "어제 HH:mm"
  const rel = m.match(/^(오늘|어제)\s+(\d{1,2}):(\d{2})$/);
  if (rel) {
    const day = rel[1] === "오늘" ? TODAY : YESTERDAY;
    return new Date(`${day}T${rel[2].padStart(2, "0")}:${rel[3]}:00+09:00`);
  }
  // "M/D HH:mm"
  const md = m.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (md) {
    return new Date(`${YEAR}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}T${md[3].padStart(2, "0")}:${md[4]}:00+09:00`);
  }
  return null;
}

// 시드 고정 문자열 전용: 반드시 Date를 돌려준다(파싱 실패는 시드 버그).
function ts(s: string): Date {
  const d = toTimestamp(s);
  if (!d) throw new Error(`시드 타임스탬프 파싱 실패: ${s}`);
  return d;
}

async function main() {
  const db = getDefaultDb();
  let inserted = 0;
  for (const c of initialCustomers) {
    const [row] = await db
      .insert(customers)
      .values({
        customerCode: c.customerId,
        name: c.name,
        phone: c.phone.replace(/\D/g, ""), // DB엔 숫자만 저장(표시는 프론트에서 포맷)

        customerType: c.customerType,
        customerTypeDetail: c.customerTypeDetail,
        team: c.team,
        source: c.source,
        statusGroup: c.statusGroup,
        status: c.status,
        priority: c.priority,
        aiSummary: c.aiSummary,
        needModel: c.vehicle,
        needMethod: c.method,
        receivedAt: toTimestamp(c.receivedAt),
        assignedAt: toTimestamp(c.assignedAt),
        lastActivityAt: toTimestamp(c.date),
      })
      .onConflictDoNothing({ target: customers.customerCode })
      .returning({ id: customers.id });
    if (!row) continue; // 이미 존재(멱등)
    inserted++;
    if (c.nextAction) {
      await db.insert(customerTasks).values({ customerId: row.id, body: c.nextAction, done: false });
    }
  }
  console.log(`seeded ${inserted} customers (skipped ${initialCustomers.length - inserted} existing)`);

  // ── 김민준(CU-2605-0020) 상세 풀세트 (멱등: 컬럼 update + 자식 delete→insert) ──
  const [kim] = await db.select({ id: customers.id }).from(customers).where(eq(customers.customerCode, "CU-2605-0020"));
  if (kim) {
    await db
      .update(customers)
      .set({
        residence: "인천광역시",
        needTrim: "S 500 4M Long",
        needColors: "외장 컬러 미정 · 내장 컬러 미정",
        needTiming: "좋은 조건 즉시",
        needMemo: "월 납입액, 총비용, 중도해지 조건 차이를 비교하고 싶어함. GLC 재고 확인 후 X3 조건과 함께 다시 정리 필요.",
      })
      .where(eq(customers.id, kim.id));

    await db.delete(customerTasks).where(eq(customerTasks.customerId, kim.id));
    await db.insert(customerTasks).values([
      { customerId: kim.id, category: "체크", due: "오늘", body: "GLC 재고 가능 여부 확인", done: false },
      { customerId: kim.id, category: "견적", due: "오늘", body: "X3 조건과 총비용 비교", done: false },
      { customerId: kim.id, category: "체크", due: "내일", body: "보험 포함 여부 확인", done: false },
      { customerId: kim.id, category: "안내", due: "이번 주", body: "중도해지 조건 설명", done: false },
    ]);

    await db.delete(customerMemos).where(eq(customerMemos.customerId, kim.id));
    await db.insert(customerMemos).values([
      { customerId: kim.id, body: "기존 고객 재구매 혜택 적용 가능성 확인 필요", createdAt: ts("오늘 13:18") },
      { customerId: kim.id, body: "가족과 최종 조건을 상의한 뒤 진행 예정", createdAt: ts("오늘 13:42") },
      { customerId: kim.id, body: "카톡 선호, 통화는 오후 시간대가 비교적 수월함", createdAt: ts("오늘 14:05") },
    ]);

    await db.delete(customerSchedules).where(eq(customerSchedules.customerId, kim.id));
    await db.insert(customerSchedules).values([
      { customerId: kim.id, scheduledDate: "2026-05-26", scheduledTime: "16:00", type: "견적", memo: "GLC 재고 확인 후 X3 조건과 총비용 비교 견적 재발송" },
    ]);

    await db.delete(customerDocuments).where(eq(customerDocuments.customerId, kim.id));
    await db.insert(customerDocuments).values([
      { customerId: kim.id, title: "주민등록등본", docType: "자동인식", fileName: "등본_함승우.pdf", fileSize: 962512, fileMime: "application/pdf", sortOrder: 0 },
      { customerId: kim.id, title: "사업자등록증", docType: "자동인식", fileName: "사업자등록증_크리에이티브지안.png", fileSize: 7031251, fileMime: "image/png", sortOrder: 1 },
    ]);

    // 견적 3건 + 시나리오 3(각 1). 멱등: quote_code 기준 delete→insert(시나리오는 ON DELETE CASCADE).
    // valid_until은 시드 시점 기준 상대 오프셋(D-6/D-4/만료) — 시간 경과 시 D-day가 실제로 줄어드는 것은 정상.
    const dayOffset = (days: number): Date => new Date(Date.now() + days * 86_400_000);
    await db.delete(quotes).where(eq(quotes.customerId, kim.id));
    const quoteSeeds = [
      {
        quoteCode: "QT-2606-0001",
        entryMode: "solution",
        quoteRound: "1차",
        brandName: "벤츠",
        modelName: "Maybach S-Class",
        trimName: "S 500 4M Long",
        status: "고객 확인 전",
        appStatus: "sent",
        decisionStatus: "none",
        stockStatus: "재고있음",
        note: "보증금 30% 기준, 할인 조건 재확인 필요",
        validUntil: dayOffset(6),
        sentAt: ts("5/28 12:39"),
        viewedAt: null as Date | null,
        scenario: { purchaseMethod: "운용리스", lender: "iM캐피탈", termMonths: 60, monthlyPayment: "2473200" as string | null },
      },
      {
        quoteCode: "QT-2606-0002",
        entryMode: "solution",
        quoteRound: "2차",
        brandName: "벤츠",
        modelName: "Maybach S-Class",
        trimName: "S 500 4M Long",
        status: "고객 열람",
        appStatus: "viewed",
        decisionStatus: "confirmed",
        stockStatus: "재고확인중",
        note: "가족 상의 후 최종 조건 확인 예정",
        validUntil: dayOffset(4),
        sentAt: ts("5/28 12:39"),
        viewedAt: ts("5/29 16:08"),
        scenario: { purchaseMethod: "운용리스", lender: "우리금융캐피탈", termMonths: 60, monthlyPayment: "2398000" as string | null },
      },
      {
        quoteCode: "QT-2606-0003",
        entryMode: "manual",
        quoteRound: "1차",
        brandName: "벤츠",
        modelName: "GLC",
        trimName: "재고 비교",
        status: "작성중",
        appStatus: "draft",
        decisionStatus: "none",
        stockStatus: "재고확인중",
        note: "GLC 재고 확인 후 X3 조건과 총비용 비교",
        validUntil: dayOffset(-1),
        sentAt: null as Date | null,
        viewedAt: null as Date | null,
        scenario: { purchaseMethod: "비교 견적", lender: null as string | null, termMonths: null as number | null, monthlyPayment: null as string | null },
      },
    ];
    for (const q of quoteSeeds) {
      const [qrow] = await db
        .insert(quotes)
        .values({
          quoteCode: q.quoteCode,
          customerId: kim.id,
          entryMode: q.entryMode,
          quoteRound: q.quoteRound,
          brandName: q.brandName,
          modelName: q.modelName,
          trimName: q.trimName,
          status: q.status,
          appStatus: q.appStatus,
          decisionStatus: q.decisionStatus,
          stockStatus: q.stockStatus,
          note: q.note,
          validUntil: q.validUntil,
          sentAt: q.sentAt,
          viewedAt: q.viewedAt,
        })
        .returning({ id: quotes.id });
      const [srow] = await db
        .insert(quoteScenarios)
        .values({
          quoteId: qrow.id,
          scenarioNo: 1,
          isSaved: q.appStatus !== "draft",
          purchaseMethod: q.scenario.purchaseMethod,
          lender: q.scenario.lender,
          termMonths: q.scenario.termMonths,
          monthlyPayment: q.scenario.monthlyPayment,
        })
        .returning({ id: quoteScenarios.id });
      // 순환 FK 회피: 시나리오 INSERT 후 대표 지정.
      await db.update(quotes).set({ primaryScenarioId: srow.id }).where(eq(quotes.id, qrow.id));
    }
    console.log("seeded 김민준(CU-2605-0020) detail: tasks 4 / memos 3 / schedules 1 / documents 2 / quotes 3");
  }

  process.exit(0);
}

void main();
