import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { ASSISTANT_TOOL_KEYS } from "../../lib/assistant-tools";
import { getDefaultDb } from "../client";
import { consultationRequests, profiles } from "../public-app";
import { consultationDismissals, customers, customerTasks, quotes } from "../schema";
import { runAssistantTool } from "./assistant-tools";

const db = getDefaultDb();
let CUST = "";
let TASK = "";
let CONSULT_USER = ""; // 실존 profiles.id — public.consultations.user_id FK 때문에 임의 uuid 불가
let CONSULT_KEEP = ""; // 유지되는 상담신청(customer_consultations에 노출돼야 함)
let CONSULT_DISMISS = ""; // CRM에서 숨김 처리된 상담신청(제외돼야 함)
const SUFFIX = crypto.randomUUID().slice(0, 8);
const OWNER = crypto.randomUUID(); // 담당 상담사(advisor_id — loose id라 profiles 행 불필요)
const OTHER = crypto.randomUUID(); // 남의 상담사
// 현재 사용자 식별자(current_user·mine의 "나") — 대부분 테스트에선 무관해 임의 uuid.
const USER = { id: crypto.randomUUID(), role: "admin" };

beforeAll(async () => {
  // customer_consultations는 public.consultations.user_id FK(profiles) 때문에 실존 profile id가 필요하다
  // (consultations.test.ts와 동일 규약) — customers.app_user_id는 loose id라 그 값을 그대로 재사용한다.
  const [p] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!p) throw new Error("profiles가 비어 있어 테스트 불가(실 master DB 전제)");
  CONSULT_USER = p.id;

  // 랜덤 서픽스 — 공유 master 재실행 트랩 방지(embed-sources.test.ts와 동일 규약).
  const [c] = await db.insert(customers).values({
    customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "도구테스트", chance: "높음", statusGroup: "견적", status: "견적상담중", advisorId: OWNER, appUserId: CONSULT_USER,
  }).returning({ id: customers.id });
  CUST = c.id;
  const [t] = await db.insert(customerTasks).values({ customerId: CUST, body: "도구 스모크 할일", due: "오늘", done: false }).returning({ id: customerTasks.id });
  TASK = t.id;
  // customer_quotes 검증용 견적 2개 — 발송완료(BMW, 열람) + 작성중(쏘렌토). 코퍼스가 아니라 crm.quotes 직접 조회 도구라 임베딩 무관.
  await db.insert(quotes).values([
    { customerId: CUST, quoteCode: `QT-AITOOL-${SUFFIX}-1`, brandName: "BMW", modelName: "7 Series", trimName: "740i xDrive M Spt", appStatus: "sent", viewedAt: new Date() },
    { customerId: CUST, quoteCode: `QT-AITOOL-${SUFFIX}-2`, brandName: "기아", modelName: "쏘렌토", trimName: "노블레스", appStatus: "draft" },
  ]);
  // customer_consultations 검증용 상담신청 2건 — 유지 1건 + 숨김 처리 1건(dismissed 제외 확인).
  const [keep] = await db.insert(consultationRequests).values({
    id: crypto.randomUUID(), userId: CONSULT_USER, customerName: "도구테스트", phoneNumber: "01000000000",
    carModel: `BMW X5 ${SUFFIX}`, notes: `리스 상담 원함 ${SUFFIX}`, status: "pending", createdAt: new Date().toISOString(),
  }).returning({ id: consultationRequests.id });
  CONSULT_KEEP = keep.id;
  const [dismiss] = await db.insert(consultationRequests).values({
    id: crypto.randomUUID(), userId: CONSULT_USER, customerName: "도구테스트", phoneNumber: "01000000000",
    carModel: `벤츠 GLE ${SUFFIX}`, notes: `숨김 대상 상담 ${SUFFIX}`, status: "pending", createdAt: new Date().toISOString(),
  }).returning({ id: consultationRequests.id });
  CONSULT_DISMISS = dismiss.id;
  await db.insert(consultationDismissals).values({ consultationId: CONSULT_DISMISS, dismissedBy: null });
});

afterAll(async () => {
  await db.delete(consultationDismissals).where(eq(consultationDismissals.consultationId, CONSULT_DISMISS));
  await db.delete(consultationRequests).where(eq(consultationRequests.id, CONSULT_KEEP));
  await db.delete(consultationRequests).where(eq(consultationRequests.id, CONSULT_DISMISS));
  await db.delete(quotes).where(eq(quotes.customerId, CUST)); // FK — 고객 삭제 전
  await db.delete(customerTasks).where(eq(customerTasks.id, TASK));
  await db.delete(customers).where(eq(customers.id, CUST));
});

test("runAssistantTool: 전 도구 throw 없이 {label, lines[]} 반환(실 DB 스모크)", async () => {
  for (const key of ASSISTANT_TOOL_KEYS) {
    const r = await runAssistantTool(key, {}, "all", USER, db);
    expect(typeof r.label).toBe("string");
    expect(Array.isArray(r.lines)).toBe(true);
    for (const line of r.lines) expect(typeof line).toBe("string");
  }
});

test("today_actions: 기한 오늘 미완료 할일이 고객명과 함께 잡힌다", async () => {
  const r = await runAssistantTool("today_actions", {}, "all", USER, db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes("도구 스모크 할일") && l.includes("기한 오늘"))).toBe(true);
});

test("chance_ranking: chance 있는 고객만, 확정이 높음보다 앞", async () => {
  const r = await runAssistantTool("chance_ranking", {}, "all", USER, db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes("높음"))).toBe(true);
  const firstJeong = r.lines.findIndex((l) => l.includes("확정"));
  const firstHigh = r.lines.findIndex((l) => l.includes("계약 가능성 높음"));
  if (firstJeong !== -1 && firstHigh !== -1) expect(firstJeong).toBeLessThan(firstHigh);
});

test("quote_ready: 진행 상태 견적 단계 고객이 사유와 함께 잡힌다", async () => {
  const r = await runAssistantTool("quote_ready", {}, "all", USER, db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes("견적 단계"))).toBe(true);
});

test("stale_customers: 방금 만든 고객(활동 0일)은 미포함", async () => {
  const r = await runAssistantTool("stale_customers", {}, "all", USER, db);
  expect(r.lines.some((l) => l.includes("도구테스트"))).toBe(false);
});

test("search_customers: 상담경로 부분 일치('앱') + 이름 필터, 미지 파라미터 무시", async () => {
  const bySource = await runAssistantTool("search_customers", { source: "테스트경로없음" }, "all", USER, db);
  expect(bySource.lines).toHaveLength(0); // 없는 경로 → 0건(라벨에 필터 병기)
  expect(bySource.label).toContain("상담경로 테스트경로없음");
  const byName = await runAssistantTool("search_customers", { name: "도구테스트", junk: 123 }, "all", USER, db);
  expect(byName.lines.some((l) => l.includes("도구테스트") && l.includes("진행 견적"))).toBe(true);
});

// customer_quotes(특정 고객 견적 목록, 2026-07-07) — 견적 개수/차종 질문에 search_customers가 견적을
// 조회하지 않아 모델이 환각하던 문제(존재하지 않는 코드·차종)의 근본 해법. crm.quotes 직접 조회.
test("customer_quotes: 특정 고객 견적을 코드·차종·발송 상태로 정확히 반환", async () => {
  const r = await runAssistantTool("customer_quotes", { name: "도구테스트" }, "all", USER, db);
  expect(r.lines).toHaveLength(2);
  expect(r.lines.some((l) => l.includes("BMW 7 Series 740i") && l.includes("발송완료"))).toBe(true);
  expect(r.lines.some((l) => l.includes("쏘렌토") && l.includes("작성중"))).toBe(true);
  expect(r.lines.every((l) => l.includes(`QT-AITOOL-${SUFFIX}`))).toBe(true); // 코드 정확(환각 아님)
  expect(r.label).toContain("이름 도구테스트");
});

test("customer_quotes: 없는 이름은 0건(환각 금지 — 도구가 빈 결과를 명시)", async () => {
  const r = await runAssistantTool("customer_quotes", { name: "존재안함이름XYZ" }, "all", USER, db);
  expect(r.lines).toHaveLength(0);
});

// mine(질문 의도 필터, 2026-07-07) — 권한 경계(scope)와 별개로 "내 담당"을 좁힌다.
// admin(scope="all")이 "내가 계약한 고객"을 물을 때 전체가 아니라 본인 담당만 나오게 하는 조각.
test("search_customers: mine=true → 현재 사용자(user.id)가 담당인 고객만", async () => {
  const asOwner = await runAssistantTool("search_customers", { name: "도구테스트", mine: true }, "all", { id: OWNER, role: "admin" }, db);
  expect(asOwner.lines.some((l) => l.includes("도구테스트"))).toBe(true);
  expect(asOwner.label).toContain("내 담당");
  const asStranger = await runAssistantTool("search_customers", { name: "도구테스트", mine: true }, "all", { id: OTHER, role: "admin" }, db);
  expect(asStranger.lines).toHaveLength(0);
});

// current_user("난 누구야?", 2026-07-07) — 본인 정보 리포트(이름·역할·담당 고객 수).
test("current_user: 실 profile이면 이름·역할, 담당 고객 수 병기 — 미상 프로필은 이름 미상 폴백", async () => {
  // btrim 필터 + trim 단언 — 실 master의 이름에 선/후행 공백이 있어도 안 깨진다(리포트는 trim된 이름).
  const [p] = await db
    .select({ id: profiles.id, name: profiles.fullName, role: profiles.role })
    .from(profiles)
    .where(sql`btrim(coalesce(${profiles.fullName}, '')) <> ''`)
    .limit(1);
  expect(p).toBeDefined(); // master에 이름 있는 계정 상존(자메스관리자 등)
  const known = await runAssistantTool("current_user", {}, "all", { id: p.id, role: p.role ?? "admin" }, db);
  expect(known.lines).toHaveLength(1);
  expect(known.lines[0]).toContain(p.name!.trim());
  expect(known.lines[0]).toContain("담당 고객");

  const unknown = await runAssistantTool("current_user", {}, "all", { id: crypto.randomUUID(), role: "staff" }, db);
  expect(unknown.lines[0]).toContain("이름 미상");
  expect(unknown.lines[0]).toContain("상담사(staff)"); // profiles 없으면 JWT role로 폴백
  expect(unknown.lines[0]).toContain("담당 고객 0명");
});

// customer_consultations(특정 고객 상담신청 목록, 2026-07-08) — 앱 상담신청의 관심 차종·문의 내용을
// 물으면 search_customers/customer_quotes가 상담 데이터를 조회하지 않아 "상담신청 안 했다"로 오답하던
// 문제의 해법. public.consultations를 CRM 고객(app_user_id)에 연결해 직접 조회, CRM 숨김(dismissed) 제외.
test("customer_consultations: 연결된 고객의 상담신청이 관심 차종·문의 내용과 함께 반환되고, 숨김 처리된 건은 제외된다", async () => {
  const r = await runAssistantTool("customer_consultations", { name: "도구테스트" }, "all", USER, db);
  expect(r.lines.some((l) => l.includes("도구테스트") && l.includes(`BMW X5 ${SUFFIX}`) && l.includes(`리스 상담 원함 ${SUFFIX}`))).toBe(true);
  expect(r.lines.every((l) => !l.includes(`벤츠 GLE ${SUFFIX}`) && !l.includes(`숨김 대상 상담 ${SUFFIX}`))).toBe(true); // dismissed 제외
  expect(r.label).toContain("이름 도구테스트");
});

test("customer_consultations: 없는 이름은 0건(환각 금지 — 도구가 빈 결과를 명시)", async () => {
  const r = await runAssistantTool("customer_consultations", { name: "존재안함이름XYZ" }, "all", USER, db);
  expect(r.lines).toHaveLength(0);
});

// 역할 scope(이사님 요구 07-06): 상담사는 본인 담당(advisor_id) 고객만 — 도구 공통 필터.
test("scope {advisorId}: 본인 담당 고객만 — 남의 scope에는 0건", async () => {
  for (const key of ["today_actions", "chance_ranking", "quote_ready"] as const) {
    const own = await runAssistantTool(key, {}, { advisorId: OWNER }, USER, db);
    expect(own.lines.some((l) => l.includes("도구테스트"))).toBe(true);
    const other = await runAssistantTool(key, {}, { advisorId: OTHER }, USER, db);
    expect(other.lines.some((l) => l.includes("도구테스트"))).toBe(false);
  }
  const bySearch = await runAssistantTool("search_customers", { name: "도구테스트" }, { advisorId: OTHER }, USER, db);
  expect(bySearch.lines).toHaveLength(0);
  const byQuotes = await runAssistantTool("customer_quotes", { name: "도구테스트" }, { advisorId: OTHER }, USER, db);
  expect(byQuotes.lines).toHaveLength(0); // 견적도 customers 조인으로 scope 필터
  const byConsultations = await runAssistantTool("customer_consultations", { name: "도구테스트" }, { advisorId: OTHER }, USER, db);
  expect(byConsultations.lines).toHaveLength(0); // 상담신청도 customers 조인으로 scope 필터
});
