import { test, expect, beforeAll, afterAll } from "bun:test";
import { eq, inArray, isNotNull, sql } from "drizzle-orm";

import { formatPhone } from "../../../client/src/lib/phone-format";
import { withNotifyGuard } from "../../test-utils/notify-gate";
import { ASSISTANT_TOOL_KEYS } from "../../lib/assistant-tools";
import { getDefaultDb } from "../client";
import { consultationRequests, profiles } from "../public-app";
import { consultationDismissals, customers, customerTasks, quotes } from "../schema";
import { capReportLines, daysSince, runAssistantTool } from "./assistant-tools";

const db = getDefaultDb();
let CUST = "";
let RECONTACT_CUST = ""; // 재문의 + 40일 무활동 + 계약완료 — stale_customers·delivery_risk 재문의 우선 검증
let MANUAL_CUSTS: string[] = []; // 수동 관리 상태 3상태(유효 정상·유효 지연·만료) — 스누즈 검증(⑦-①)
let TASK = "";
let CONSULT_USER = ""; // 실존 profiles.id — public.consultations.user_id FK 때문에 임의 uuid 불가
let CONSULT_USER_PHONE = ""; // 그 프로필의 phone_number — 앱 연결 고객 주 번호 합성 검증의 기대값
let CONTACT_CUST = ""; // 앱 미연결 + 주 번호/추가 연락처 보유 — 컬럼 경로·라벨 구분 검증
let CONSULT_OLD = ""; // 유지되는 상담신청(오래된 쪽 — 정렬 검증)
let CONSULT_NEW = ""; // 유지되는 상담신청(최신 쪽 — 절단 시 보존돼야 하는 행)
let CONSULT_DISMISS = ""; // CRM에서 숨김 처리된 상담신청(제외돼야 함)
const T0 = Date.now();
const SUFFIX = crypto.randomUUID().slice(0, 8);
const OWNER = crypto.randomUUID(); // 담당 상담사(advisor_id — loose id라 profiles 행 불필요)
const OTHER = crypto.randomUUID(); // 남의 상담사
// 현재 사용자 식별자(current_user·mine의 "나") — 대부분 테스트에선 무관해 임의 uuid.
const USER = { id: crypto.randomUUID(), role: "admin" };

beforeAll(async () => {
  // customer_consultations는 public.consultations.user_id FK(profiles) 때문에 실존 profile id가 필요하다
  // (consultations.test.ts와 동일 규약) — customers.app_user_id는 loose id라 그 값을 그대로 재사용한다.
  // ⚠️ **번호가 있는** 프로필을 고른다 — 앱 연결 고객의 주 번호는 `profiles.phone_number` 합성이라
  // 번호 없는 프로필을 잡으면 그 회귀 테스트가 공허하게 통과한다. `crm.customers.app_user_id`는
  // 부분 unique 인덱스(`customers_app_user_id_unique`)라 **이미 연결된 프로필은 못 쓴다** → 미점유로 좁힌다.
  // profiles는 read-only 계약이라 번호를 심을 수 없어서, 있는 데이터에서 고르는 게 유일한 방법이다.
  const linkedRows = await db.select({ id: customers.appUserId }).from(customers).where(isNotNull(customers.appUserId));
  const taken = new Set(linkedRows.map((r) => r.id));
  const phoned = await db.select({ id: profiles.id, phoneNumber: profiles.phoneNumber }).from(profiles).where(isNotNull(profiles.phoneNumber));
  const p = phoned.find((c) => !taken.has(c.id));
  if (!p) throw new Error("번호를 가진 미점유 profiles가 없어 테스트 불가(실 master DB 전제)");
  CONSULT_USER = p.id;
  CONSULT_USER_PHONE = p.phoneNumber ?? "";

  // 랜덤 서픽스 — 공유 master 재실행 트랩 방지(embed-sources.test.ts와 동일 규약).
  const [c] = await db.insert(customers).values({
    customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "도구테스트", chance: "높음", statusGroup: "견적", status: "견적상담중", advisorId: OWNER, appUserId: CONSULT_USER,
  }).returning({ id: customers.id });
  CUST = c.id;
  // 재문의 고객 — updated_at을 40일 전으로 고정(자식 행 없음 → staffActivityAt = updated_at).
  // 목록 배지는 이 고객을 기간 무관 "재문의"로 표시한다(finalUpdateStatus recontacted 우선) —
  // AI 리포트도 같은 라벨이어야 한다(이사님 2026-07-13 ①: 목록과 통일).
  const [rc] = await db.insert(customers).values({
    customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "재문의도구테스트", recontacted: true,
    statusGroup: "계약완료", status: "배정완료", advisorId: OWNER, updatedAt: new Date(T0 - 40 * 86_400_000),
  }).returning({ id: customers.id });
  RECONTACT_CUST = rc.id;
  // 앱 미연결 고객 — 주 번호는 crm 컬럼이 진실이고 추가 연락처(phone_secondary)도 함께 싣는지 검증.
  // ⚠️ app_user_id를 주지 않는다 — CHECK(customers_phone_app_exclusive_check)가 phone과 배타라 연결 고객엔 못 넣는다.
  const [ct] = await db.insert(customers).values({
    customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "연락처도구테스트",
    phone: "01011112222", phoneSecondary: "01033334444", advisorId: OWNER,
  }).returning({ id: customers.id });
  CONTACT_CUST = ct.id;
  // 수동 관리 상태(스누즈, ⑦-①) 3상태 — 전부 40일 무활동·계약완료(두 리포트 모두 도달).
  // 유효 "정상": manage_status_at(now) > updated_at(40일 전) → 두 리포트에서 제외돼야 한다.
  // 유효 "지연"(+recontacted): 수동이 재문의보다 우선 — 라벨 "지연(수동 지정)". 만료: manage_status_at(50일 전) <
  // updated_at(40일 전) → 파생(장기방치) 복귀.
  // "신선" 3종 = 설정 직후 창(항목 8 ①): updated_at = manage_status_at = T0(동일 스탬프 계약의 실제
  // 도달 상태) → 무활동 0일·버킷 미성립. 유효 수동 비'정상'은 일수 게이트 무관 리포트 포함(목록 배지와
  // 멤버십 일치 — 유슨생 선승인 2026-07-13·이사님 사후 확인 대기, 확인 대기 항목 8). 신규·상담접수도
  // 유효 수동 비'정상'이면 포함(수동 지정 자체가 상담사 액션 — B2 기각 번복 2026-07-14, 유슨생 승인.
  // 목록 배지·필터·드로어가 수동을 인정하므로 리포트만 빼면 배지↔리포트 모순).
  const manualRows = await db.insert(customers).values([
    { customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "수동정상도구테스트", statusGroup: "계약완료", status: "배정완료", updatedAt: new Date(T0 - 40 * 86_400_000), manageStatus: "정상", manageStatusAt: new Date(T0) },
    { customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "수동지연도구테스트", statusGroup: "계약완료", status: "배정완료", recontacted: true, updatedAt: new Date(T0 - 40 * 86_400_000), manageStatus: "지연", manageStatusAt: new Date(T0) },
    { customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "수동만료도구테스트", statusGroup: "계약완료", status: "배정완료", updatedAt: new Date(T0 - 40 * 86_400_000), manageStatus: "정상", manageStatusAt: new Date(T0 - 50 * 86_400_000) },
    { customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "수동신선지연도구테스트", statusGroup: "계약완료", status: "배정완료", updatedAt: new Date(T0), manageStatus: "지연", manageStatusAt: new Date(T0) },
    { customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "수동신선정상도구테스트", statusGroup: "계약완료", status: "배정완료", updatedAt: new Date(T0), manageStatus: "정상", manageStatusAt: new Date(T0) },
    { customerCode: `CU-AITOOL-${crypto.randomUUID().slice(0, 8)}`, name: "수동신선신규도구테스트", statusGroup: "신규", status: "상담접수", updatedAt: new Date(T0), manageStatus: "지연", manageStatusAt: new Date(T0) },
  ]).returning({ id: customers.id });
  MANUAL_CUSTS = manualRows.map((r) => r.id);
  const [t] = await db.insert(customerTasks).values({ customerId: CUST, body: "도구 스모크 할일", due: "오늘", done: false }).returning({ id: customerTasks.id });
  TASK = t.id;
  // customer_quotes 검증용 견적 2개 — 발송완료(BMW, 열람) + 작성중(쏘렌토). 코퍼스가 아니라 crm.quotes 직접 조회 도구라 임베딩 무관.
  // created_at을 명시해 시간 순서를 고정한다(정렬 검증 — 같은 배치 INSERT의 default now()는 동일 값이라 순서를 못 잡는다).
  await db.insert(quotes).values([
    { customerId: CUST, quoteCode: `QT-AITOOL-${SUFFIX}-1`, brandName: "BMW", modelName: "7 Series", trimName: "740i xDrive M Spt", appStatus: "sent", viewedAt: new Date(), createdAt: new Date(T0 - 60_000) },
    { customerId: CUST, quoteCode: `QT-AITOOL-${SUFFIX}-2`, brandName: "기아", modelName: "쏘렌토", trimName: "노블레스", appStatus: "draft", createdAt: new Date(T0) },
  ]);
  // customer_consultations 검증용 상담신청 3건 — 유지 2건(오래된/최신, 정렬 검증) + 숨김 처리 1건(dismissed 제외 확인).
  // public.consultations INSERT는 on_consultation_created 트리거 → 운영 디스코드 알림을 낸다.
  await withNotifyGuard(db, async (tx) => {
    const [old] = await tx.insert(consultationRequests).values({
      id: crypto.randomUUID(), userId: CONSULT_USER, customerName: "도구테스트", phoneNumber: "01000000000",
      carModel: `BMW X5 ${SUFFIX}`, notes: `리스 상담 원함 ${SUFFIX}`, status: "pending", createdAt: new Date(T0 - 60_000).toISOString(),
    }).returning({ id: consultationRequests.id });
    CONSULT_OLD = old.id;
    const [recent] = await tx.insert(consultationRequests).values({
      id: crypto.randomUUID(), userId: CONSULT_USER, customerName: "도구테스트", phoneNumber: "01000000000",
      carModel: `아우디 Q7 ${SUFFIX}`, notes: `최신 문의 ${SUFFIX}`, status: "pending", createdAt: new Date(T0).toISOString(),
    }).returning({ id: consultationRequests.id });
    CONSULT_NEW = recent.id;
    const [dismiss] = await tx.insert(consultationRequests).values({
      id: crypto.randomUUID(), userId: CONSULT_USER, customerName: "도구테스트", phoneNumber: "01000000000",
      carModel: `벤츠 GLE ${SUFFIX}`, notes: `숨김 대상 상담 ${SUFFIX}`, status: "pending", createdAt: new Date(T0 - 30_000).toISOString(),
    }).returning({ id: consultationRequests.id });
    CONSULT_DISMISS = dismiss.id;
    await tx.insert(consultationDismissals).values({ consultationId: CONSULT_DISMISS, dismissedBy: null });
  });
});

afterAll(async () => {
  await db.delete(consultationDismissals).where(eq(consultationDismissals.consultationId, CONSULT_DISMISS));
  await db.delete(consultationRequests).where(eq(consultationRequests.id, CONSULT_OLD));
  await db.delete(consultationRequests).where(eq(consultationRequests.id, CONSULT_NEW));
  await db.delete(consultationRequests).where(eq(consultationRequests.id, CONSULT_DISMISS));
  await db.delete(quotes).where(eq(quotes.customerId, CUST)); // FK — 고객 삭제 전
  await db.delete(customerTasks).where(eq(customerTasks.id, TASK));
  await db.delete(customers).where(eq(customers.id, CUST));
  await db.delete(customers).where(eq(customers.id, RECONTACT_CUST));
  await db.delete(customers).where(eq(customers.id, CONTACT_CUST));
  if (MANUAL_CUSTS.length) await db.delete(customers).where(inArray(customers.id, MANUAL_CUSTS));
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
  // "도구테스트"는 다른 픽스처 이름(재문의·수동*도구테스트)의 부분 문자열 — 라인 시작(이름 자리)으로 정밀 매칭.
  expect(r.lines.some((l) => l.startsWith("도구테스트 —"))).toBe(false);
});

// 재문의 고객은 stale 버킷 라벨 대신 "재문의"로 표기(이사님 2026-07-13 ① — 목록 배지와 통일).
// 문제의 본질은 노출이 아니라 오표기: 40일 무활동 재문의 고객이 목록 "재문의" / AI "장기방치"로 모순됐다.
test("stale_customers: 재문의 고객은 '장기방치' 대신 '재문의' 표기(무활동 일수는 유지)", async () => {
  const r = await runAssistantTool("stale_customers", {}, "all", USER, db);
  const line = r.lines.find((l) => l.includes("재문의도구테스트"));
  expect(line).toBeDefined();
  expect(line).toContain("재문의(고객이 먼저 다시 연락)");
  expect(line).toContain("40일 무활동");
  expect(line).not.toContain("장기방치");
});

test("delivery_risk: 재문의 고객은 재문의 병기(계약완료 무활동 리포트에서도 오표기 방지)", async () => {
  const r = await runAssistantTool("delivery_risk", {}, "all", USER, db);
  const line = r.lines.find((l) => l.includes("재문의도구테스트"));
  expect(line).toBeDefined();
  expect(line).toContain("재문의(고객이 먼저 다시 연락)");
});

// ── 수동 관리 상태(스누즈, 이사님 2026-07-13 ⑦-①) — 유효/우선순위/만료 3상태 ─────────────────
test("stale_customers: 유효한 수동 '정상'은 리포트 제외(목록 배지 정상과 모순 방지)", async () => {
  const r = await runAssistantTool("stale_customers", {}, "all", USER, db);
  expect(r.lines.some((l) => l.includes("수동정상도구테스트"))).toBe(false);
});

test("stale_customers: 유효한 수동 상태가 재문의·버킷보다 우선 — '지연(수동 지정)' 표기", async () => {
  const r = await runAssistantTool("stale_customers", {}, "all", USER, db);
  const line = r.lines.find((l) => l.includes("수동지연도구테스트"));
  expect(line).toBeDefined();
  expect(line).toContain("지연(수동 지정)");
  expect(line).not.toContain("장기방치"); // 버킷(40일)에 밀리지 않는다
  expect(line).not.toContain("먼저 다시 연락"); // recontacted=true여도 수동이 우선(클라 override 우선 미러)
});

test("stale_customers: 만료된 수동 상태(manage_status_at < 활동)는 무시 — 파생(장기방치) 복귀", async () => {
  const r = await runAssistantTool("stale_customers", {}, "all", USER, db);
  const line = r.lines.find((l) => l.includes("수동만료도구테스트"));
  expect(line).toBeDefined();
  expect(line).toContain("장기방치");
  expect(line).not.toContain("수동 지정");
});

test("delivery_risk: 유효 수동 '정상' 제외 + 유효 수동 '지연' 병기", async () => {
  const r = await runAssistantTool("delivery_risk", {}, "all", USER, db);
  expect(r.lines.some((l) => l.includes("수동정상도구테스트"))).toBe(false);
  const delayed = r.lines.find((l) => l.includes("수동지연도구테스트"));
  expect(delayed).toBeDefined();
  expect(delayed).toContain("지연(수동 지정)");
});

// ── 항목 8 ①: 유효 수동 비'정상'은 일수 게이트 무관 멤버십(설정 직후 창 — 목록 배지와 일치) ─────
// 수동 지정 PATCH가 updated_at을 bump해 무활동 0일에서 시작 → 구 멤버십("무활동 7일+"만)에선
// 설정 직후 ~7일간 배지는 "지연"인데 리포트에 없었다(배치 4 감사 B1). 유슨생 선승인·이사님 사후 확인.
test("stale_customers: 유효 수동 '지연' + 무활동 0일(버킷 미성립)도 포함 — 설정 직후 배지와 일치", async () => {
  const r = await runAssistantTool("stale_customers", {}, "all", USER, db);
  const line = r.lines.find((l) => l.includes("수동신선지연도구테스트"));
  expect(line).toBeDefined();
  expect(line).toContain("지연(수동 지정)");
  expect(line).toContain("0일 무활동"); // 일수는 사실대로 병기(라벨만 수동)
});

test("stale_customers: 유효 수동 '정상' + 무활동 0일은 계속 제외(수동 경유 진입도 정상은 차단)", async () => {
  const r = await runAssistantTool("stale_customers", {}, "all", USER, db);
  expect(r.lines.some((l) => l.includes("수동신선정상도구테스트"))).toBe(false);
});

test("stale_customers: 신규·상담접수도 유효 수동 비'정상'이면 포함(수동 지정 = 상담사 액션 — 배치 4 B2 기각 번복 2026-07-14, 목록 배지 표시와 미러)", async () => {
  const r = await runAssistantTool("stale_customers", {}, "all", USER, db);
  const line = r.lines.find((l) => l.includes("수동신선신규도구테스트"));
  expect(line).toBeDefined();
  expect(line).toContain("지연(수동 지정)");
});

test("delivery_risk: 유효 수동 '지연' + 무활동 0일(임계 미달)도 포함", async () => {
  const r = await runAssistantTool("delivery_risk", {}, "all", USER, db);
  const line = r.lines.find((l) => l.includes("수동신선지연도구테스트"));
  expect(line).toBeDefined();
  expect(line).toContain("지연(수동 지정)");
});

// 무활동 일수는 KST 달력일 차(0709 감사) — floor(경과/24h)면 목록 배지(달력일)와 경계에서 갈려
// 같은 고객이 목록 '확인필요'인데 stale_customers 리포트엔 안 뜨는 화면 내 모순이 난다.
test("daysSince: KST 달력일 차 — 경과 6일 23시간은 7일(경과 24h 개수 아님)", () => {
  const now = new Date("2026-01-08T12:00:00+09:00");
  expect(daysSince(new Date("2026-01-01T13:00:00+09:00"), now)).toBe(7);
  expect(daysSince("2026-01-07T23:59:00+09:00", now)).toBe(1); // 자정 넘김 = 1일
  expect(daysSince(new Date("2026-01-08T09:00:00+09:00"), now)).toBe(0);
  expect(daysSince(new Date("2026-01-09T09:00:00+09:00"), now)).toBe(0); // 미래 활동은 0으로 클램프
  expect(daysSince(null, now)).toBeNull();
  expect(daysSince("파싱불가", now)).toBeNull();
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

// 리포트 정렬(2026-07-09) — 행 상한(REPORT_ROW_LIMIT) 절단은 뒤를 버리므로 최신이 앞에 와야 보존된다.
// ASC면 가장 오래된 30건만 남고 최신이 잘린다("최근 견적/문의" 질문에 가장 관련 높은 행이 유실).
test("customer_quotes: 최신 견적이 먼저 — 상한 절단이 최신을 보존한다", async () => {
  const r = await runAssistantTool("customer_quotes", { name: "도구테스트" }, "all", USER, db);
  expect(r.lines[0]).toContain("쏘렌토"); // T0
  expect(r.lines[1]).toContain("BMW 7 Series"); // T0 - 60s
});

// mine(질문 의도 필터, 2026-07-07) — 권한 경계(scope)와 별개로 "내 담당"을 좁힌다.
// admin(scope="all")이 "내가 계약한 고객"을 물을 때 전체가 아니라 본인 담당만 나오게 하는 조각.
// 연락처 2종(2026-07-23) — "제임스 연락처?"에 AI가 "조회 결과에 연락처 정보가 없습니다"라고 답한 실사고에서 왔다.
// 도구 프로젝션에 phone이 아예 없었던 게 원인이고, 고칠 때 **컬럼만 읽으면 앱 연결 고객이 조용히 빈다**
// (CHECK로 crm.customers.phone이 항상 NULL) — 그래서 합성 경로를 직접 잠근다.
test("search_customers: 앱 연결 고객의 주 번호를 profiles에서 합성해 싣는다(컬럼은 NULL — 실사고 회귀)", async () => {
  const r = await runAssistantTool("search_customers", { name: "도구테스트" }, "all", USER, db);
  const line = r.lines.find((l) => l.startsWith("도구테스트 —"));
  expect(line).toContain(`연락처 ${formatPhone(CONSULT_USER_PHONE)}`); // 표기는 화면(고객 목록·상세)과 같은 하이픈 포맷
  // 합성이 실제로 일했다는 증거 — 컬럼 자체는 CHECK 때문에 NULL이어야 한다.
  // (이 단언이 없으면 "우연히 컬럼에 값이 있어서" 통과하는 공허한 테스트가 된다.)
  const [row] = await db.select({ phone: customers.phone }).from(customers).where(eq(customers.id, CUST));
  expect(row.phone).toBeNull();
});

test("search_customers: 미연결 고객은 컬럼 주 번호 + 추가 연락처를 라벨로 구분해 싣는다", async () => {
  const r = await runAssistantTool("search_customers", { name: "연락처도구테스트" }, "all", USER, db);
  const line = r.lines.find((l) => l.startsWith("연락처도구테스트 —"));
  expect(line).toContain("연락처 010-1111-2222");
  // phone_secondary는 회사·배우자 번호일 수 있어 "본인 번호"로 뭉뚱그리면 안 된다(소유권 계약 #276).
  expect(line).toContain("추가 연락처 010-3333-4444");
});

test("search_customers: 연락처가 없으면 '미입력'을 명시한다 — 모델이 '결과에 없음'과 '고객에게 없음'을 구분하게", async () => {
  const r = await runAssistantTool("search_customers", { name: "재문의도구테스트" }, "all", USER, db);
  const line = r.lines.find((l) => l.startsWith("재문의도구테스트 —"));
  expect(line).toContain("연락처 미입력");
  expect(line).not.toContain("추가 연락처"); // 없는 축은 아예 안 싣는다(빈 라벨 노이즈 방지)
});

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

// 실 master에 상담 44건인 고객이 있어(30 초과) ASC 절단이 최신 14건을 버리던 실버그(0709 감사).
test("customer_consultations: 최신 상담이 먼저 — 상한 절단이 최신을 보존한다", async () => {
  const r = await runAssistantTool("customer_consultations", { name: "도구테스트" }, "all", USER, db);
  expect(r.lines).toHaveLength(2); // dismissed 제외
  expect(r.lines[0]).toContain(`아우디 Q7 ${SUFFIX}`); // T0
  expect(r.lines[1]).toContain(`BMW X5 ${SUFFIX}`); // T0 - 60s
});

// 절단 안내 문구의 단위(2026-07-09) — 헬퍼가 고객 리스트("명") 전제로 쓰였는데 견적/상담 도구가 재사용해
// 한 고객의 견적 44건을 "외 14명"으로 오표기했다. 행 단위를 호출부가 정한다.
test("capReportLines: 상한 초과 시 잘림 안내의 단위가 인자를 따른다", () => {
  const lines = Array.from({ length: 31 }, (_, i) => `행${i}`);
  expect(capReportLines(lines, "명").at(-1)).toBe("외 1명 — 상위 30명만 표시");
  expect(capReportLines(lines, "건").at(-1)).toBe("외 1건 — 상위 30건만 표시");
  expect(capReportLines(lines, "건")).toHaveLength(31); // 상한 30행 + 안내 1행
  expect(capReportLines(lines.slice(0, 30), "건")).toHaveLength(30); // 상한 이하는 안내 없이 그대로
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
