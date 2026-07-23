import { test, expect, beforeAll, afterAll } from "bun:test";
import { inArray, isNotNull } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { profiles } from "../public-app";
import { customers } from "../schema";
import { getCustomerMetaByIds } from "./embeddings-meta";

const db = getDefaultDb();
let LINKED = ""; // 앱 연결 고객 — 주 번호는 profiles.phone_number 합성(customers.phone은 CHECK상 항상 NULL)
let LINKED_PHONE = ""; // 그 프로필의 실제 번호 — 합성 기대값
let MANUAL = ""; // 앱 미연결 고객 — 주 번호는 crm 컬럼이 진실 + 추가 연락처 보유

beforeAll(async () => {
  // ⚠️ **번호가 있는 미점유 프로필**을 고른다(assistant-tools.test.ts와 동일 규약).
  // 번호 없는 프로필을 잡으면 합성 회귀 테스트가 공허하게 통과하고, `customers.app_user_id`는
  // 부분 unique 인덱스라 이미 연결된 프로필은 INSERT가 거부된다. profiles는 read-only 계약이라
  // 번호를 심을 수 없어서, 있는 데이터에서 고르는 게 유일한 방법이다.
  const linkedRows = await db.select({ id: customers.appUserId }).from(customers).where(isNotNull(customers.appUserId));
  const taken = new Set(linkedRows.map((r) => r.id));
  const phoned = await db.select({ id: profiles.id, phoneNumber: profiles.phoneNumber }).from(profiles).where(isNotNull(profiles.phoneNumber));
  const p = phoned.find((row) => !taken.has(row.id));
  if (!p) throw new Error("번호를 가진 미점유 profiles가 없어 테스트 불가(실 master DB 전제)");
  LINKED_PHONE = p.phoneNumber ?? "";

  const rows = await db.insert(customers).values([
    // 앱 연결 — phone을 주지 않는다(CHECK customers_phone_app_exclusive_check가 app_user_id와 배타).
    { customerCode: `CU-CMETA-${crypto.randomUUID().slice(0, 8)}`, name: "메타연결테스트", statusGroup: "견적", status: "견적상담중", appUserId: p.id },
    { customerCode: `CU-CMETA-${crypto.randomUUID().slice(0, 8)}`, name: "메타수기테스트", statusGroup: "신규", status: "상담접수", phone: "01011112222", phoneSecondary: "01033334444" },
  ]).returning({ id: customers.id });
  LINKED = rows[0].id;
  MANUAL = rows[1].id;
});

afterAll(async () => {
  const ids = [LINKED, MANUAL].filter(Boolean);
  if (ids.length) await db.delete(customers).where(inArray(customers.id, ids));
});

// 이 테스트의 존재 이유(2026-07-23): 근거 헤더의 연락처를 `customers.phone`으로만 읽으면
// **신고된 케이스가 그대로 안 고쳐진다** — 제임스·김지안 둘 다 앱 연결이라 그 컬럼이 항상 NULL이고,
// 화면엔 번호가 보이는데 AI만 "연락처 정보가 없습니다"라고 답한다(`#332`가 도구 경로에서 밟은 그 함정).
// composedPhone + profiles 조인을 원시 컬럼으로 되돌리면 이 테스트가 RED가 된다.
test("getCustomerMetaByIds: 앱 연결 고객의 주 번호를 profiles에서 합성한다", async () => {
  const meta = (await getCustomerMetaByIds([LINKED])).get(LINKED);
  expect(meta?.name).toBe("메타연결테스트");
  expect(meta?.phone).toBe(LINKED_PHONE);
  expect(meta?.phoneSecondary).toBeNull();
});

test("getCustomerMetaByIds: 앱 미연결 고객은 crm 컬럼이 주 번호 + 추가 연락처", async () => {
  const meta = (await getCustomerMetaByIds([MANUAL])).get(MANUAL);
  expect(meta?.phone).toBe("01011112222");
  expect(meta?.phoneSecondary).toBe("01033334444");
});

// 조인을 넣으면서 기존 축(이름·상태)이 깨지지 않는지 — 상태는 그룹·2차를 "·"로 잇는다.
test("getCustomerMetaByIds: 이름·상태 축은 그대로", async () => {
  const meta = (await getCustomerMetaByIds([LINKED, MANUAL]));
  expect(meta.size).toBe(2);
  expect(meta.get(LINKED)?.status).toBe("견적·견적상담중");
  expect(meta.get(MANUAL)?.status).toBe("신규·상담접수");
});
