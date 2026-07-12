import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { withNotifyGuard } from "../../test-utils/notify-gate";
import { getDefaultDb } from "../client";
import { consultationRequests, profiles } from "../public-app";
import { consultationDismissals, customerMemos, customerTasks, customers, quotes } from "../schema";
import { loadAiHintSource, setCustomerAiHint } from "./ai-hint-sources";

const db = getDefaultDb();
const SUFFIX = crypto.randomUUID().slice(0, 8);
let CUST = "";

beforeAll(async () => {
  // 랜덤 서픽스 — 공유 master 재실행 트랩 방지(afterAll 실패 시 unique 위반 연쇄 방지).
  const [c] = await db.insert(customers).values({
    customerCode: `CU-AIHINT-${SUFFIX}`,
    name: "AI힌트소스테스트",
    statusGroup: "견적", status: "발송완료", chance: "높음", priority: "긴급",
    residence: "인천광역시 남동구", needModel: "X3",
    aiSummary: "이전 힌트", aiSummarySourceHash: "old-hash",
  }).returning({ id: customers.id });
  CUST = c.id;
  // 메모 4건(최근 3만 실려야 함) — createdAt 명시로 순서 결정화.
  for (let i = 0; i < 4; i++) {
    await db.insert(customerMemos).values({
      customerId: CUST, body: `메모${i}`, createdAt: new Date(Date.UTC(2026, 6, 1 + i)),
    });
  }
  // category는 닫힌 6종(TASK_CATEGORY_OPTIONS) CHECK 제약 — "급함/오늘"은 due 쪽 표시 라벨이지 category 값이 아니다.
  await db.insert(customerTasks).values([
    { customerId: CUST, category: "체크", due: "오늘", body: "미완료 할일", done: false },
    { customerId: CUST, category: "견적", due: "오늘", body: "완료된 할일", done: true },
  ]);
  await db.insert(quotes).values({
    customerId: CUST, quoteCode: `QT-AIHINT-${SUFFIX}`,
    modelName: "X3", trimName: "xDrive20i", appStatus: "sent",
  });
});

afterAll(async () => {
  await db.delete(quotes).where(eq(quotes.customerId, CUST)); // FK cascade 없음 — 견적 먼저
  await db.delete(customers).where(eq(customers.id, CUST));   // 메모·할일은 cascade
});

test("loadAiHintSource: 프로필 텍스트·최근 메모 3(최신순)·미완료 할일만·최신 견적·기존 hash", async () => {
  const src = await loadAiHintSource(CUST, db);
  expect(src).not.toBeNull();
  expect(src?.name).toBe("AI힌트소스테스트");
  expect(src?.profileText).toContain("거주지 인천광역시 남동구");
  expect(src?.profileText).toContain("관심 차종 X3");
  expect(src?.memos.map((m) => m.body)).toEqual(["메모3", "메모2", "메모1"]);
  expect(src?.tasks).toEqual([{ category: "체크", due: "오늘", body: "미완료 할일" }]);
  expect(src?.quote).toEqual({ modelName: "X3", trimName: "xDrive20i", appStatus: "sent" });
  expect(src?.consultationNote).toBeNull(); // app_user_id 없음 — 상담 조회 자체를 안 탄다
  expect(src?.aiSummary).toBe("이전 힌트");
  expect(src?.sourceHash).toBe("old-hash");
});

test("loadAiHintSource: 없는 고객 → null", async () => {
  expect(await loadAiHintSource(crypto.randomUUID(), db)).toBeNull();
});

test("setCustomerAiHint: ai_summary·hash 왕복 + null 클리어", async () => {
  await setCustomerAiHint(CUST, { aiSummary: "**새** 힌트", sourceHash: "h2" }, db);
  let src = await loadAiHintSource(CUST, db);
  expect(src?.aiSummary).toBe("**새** 힌트");
  expect(src?.sourceHash).toBe("h2");
  await setCustomerAiHint(CUST, { aiSummary: null, sourceHash: null }, db);
  src = await loadAiHintSource(CUST, db);
  expect(src?.aiSummary).toBeNull();
  expect(src?.sourceHash).toBeNull();
});

// 상담 분기 실왕복 — appUserId 게이트·nonEmpty(notes)·dismissed notExists·최신순 선택 전부 관통.
// consultations.user_id는 profiles(id) FK라 실존 profile id가 필요하다(읽기만, 수정 금지 —
// db/queries/consultations.test.ts anyProfileId 패턴 미러).
test("loadAiHintSource: 앱 상담 문의 — dismissed 제외·공백 notes 제외 후 live 최신 문의 선택", async () => {
  const [profile] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!profile) throw new Error("profiles가 비어 있어 테스트 불가(실 master DB 전제)");
  const userId = profile.id;
  const A = crypto.randomUUID(); // 가장 오래됨 — live
  const B = crypto.randomUUID(); // 중간 — live(이게 뽑혀야 함)
  const C = crypto.randomUUID(); // B보다 최신 — dismissed로 제외
  const D = crypto.randomUUID(); // 가장 최신 — 공백 notes로 제외(nonEmpty)
  const base = { userId, customerName: `AI힌트상담-${SUFFIX}`, phoneNumber: "01000000000", status: "pending" };
  try {
    await db.update(customers).set({ appUserId: userId }).where(eq(customers.id, CUST));
    // ⚠️ public.consultations INSERT는 handle_new_consultation 트리거(운영 디스코드 알림) 발화 —
    // 반드시 withNotifyGuard 트랜잭션(app.skip_notify SET LOCAL) 안에서만 넣는다.
    // createdAt은 원미래(2126) 고정 — 임의로 뽑은 실존 프로필에 이미 있는 live 상담이 픽스처보다
    // 최신이면 정확 일치 단언이 깨진다(공유 master의 실 앱 유입에 시한부 의존 금지).
    await withNotifyGuard(db, (tx) => tx.insert(consultationRequests).values([
      { ...base, id: A, notes: "이전 문의", createdAt: "2126-07-01T00:00:00.000Z" },
      { ...base, id: B, notes: "최신 문의", createdAt: "2126-07-02T00:00:00.000Z" },
      { ...base, id: C, notes: "무시될 문의", createdAt: "2126-07-03T00:00:00.000Z" },
      { ...base, id: D, notes: "   ", createdAt: "2126-07-04T00:00:00.000Z" },
    ]));
    await db.insert(consultationDismissals).values({ consultationId: C, dismissedBy: null }); // crm 테이블 — 트리거 무관

    const src = await loadAiHintSource(CUST, db);
    expect(src?.consultationNote).toBe("최신 문의");
  } finally {
    // appUserId 원복(다른 테스트가 상담 분기를 안 타도록) → dismissal 먼저, 상담신청 나중 삭제(DELETE는 트리거 무관).
    await db.update(customers).set({ appUserId: null }).where(eq(customers.id, CUST));
    await db.delete(consultationDismissals).where(eq(consultationDismissals.consultationId, C));
    await db.delete(consultationRequests).where(inArray(consultationRequests.id, [A, B, C, D]));
  }
});
