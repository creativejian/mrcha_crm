import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { getDefaultDb } from "../client";
import { customers } from "../schema";
import { createCustomerManual } from "./customers";
import { buildAppQuoteRequestRows, type QuoteRequestBaseRow } from "./quote-requests";

const db = getDefaultDb();
// 고정 리터럴(랜덤 서픽스 아님) — fixture-residue.ts의 customerResidueWhere()가 TEST_CUSTOMER_NAMES를
// 정확 일치(name in (...))로 검사한다(코드 접두사와 달리 regex 아님). "수기등록테스트" 등 기존 관례와 동일.
const NAME = "이름매칭테스트";
const createdIds: string[] = [];

afterAll(async () => {
  for (const id of createdIds) await db.delete(customers).where(eq(customers.id, id));
});

// quote_request_options.quote_request_id / quotes.source_quote_request_id가 uuid 컬럼이라
// id는 유효한 uuid 형식이어야 한다(존재하지 않는 uuid는 빈 결과, 비-uuid 문자열은 22P02 런타임 에러).
const SYNTHETIC_REQUEST_ID = "00000000-0000-0000-0000-00000000eeee";

// buildAppQuoteRequestRows가 요구하는 필드 전부 채운 베이스(테스트별로 requesterName/requesterPhone/userId만 다름).
function baseRow(overrides: Partial<QuoteRequestBaseRow>): QuoteRequestBaseRow {
  return {
    id: SYNTHETIC_REQUEST_ID,
    createdAt: "2026-07-18T00:00:00.000+00:00",
    userId: "00000000-0000-0000-0000-000000000000",
    trimId: null,
    paymentMethod: null,
    period: null,
    depositType: null,
    depositRatio: null,
    rentalDeposit: null,
    trimPrice: null,
    status: "open",
    colorPreferenceMode: null,
    exteriorColorId: null,
    exteriorColorName: null,
    exteriorColorHex: null,
    interiorColorId: null,
    interiorColorName: null,
    interiorColorHex: null,
    requesterName: null,
    requesterPhone: null,
    ...overrides,
  };
}

test("nameMatches — none 요청에 같은 이름 미연결 고객을 노출", async () => {
  const cust = await createCustomerManual({ name: NAME, phone: "01099998888", source: null }, db);
  createdIds.push(cust.id);

  // requesterPhone이 고객 phone과 달라 phone 매칭 실패 + userId가 어떤 고객의 appUserId도 아니라
  // app_user 매칭도 실패 → matchType은 "none"이어야 nameMatches가 채워진다.
  const rows = await buildAppQuoteRequestRows(
    [baseRow({ requesterName: NAME, requesterPhone: "01011112222" })],
    db,
  );
  const r = rows.find((x) => x.id === SYNTHETIC_REQUEST_ID);
  expect(r).toBeDefined();
  expect(r!.matchType).toBe("none");
  expect(r!.nameMatches.map((m) => m.code)).toContain(cust.customerCode);
});

test("nameMatches — phone 매칭이면(matchType!=none) nameMatches는 비운다", async () => {
  // 앞 테스트 픽스처와 다른 번호 — 두 테스트가 phone 값을 공유하지 않게 해 실행 순서 의존을 없앤다.
  const cust = await createCustomerManual({ name: NAME, phone: "01077776666", source: null }, db);
  createdIds.push(cust.id);

  const rows = await buildAppQuoteRequestRows(
    [baseRow({ requesterName: NAME, requesterPhone: "01077776666" })],
    db,
  );
  const r = rows.find((x) => x.id === SYNTHETIC_REQUEST_ID);
  expect(r).toBeDefined();
  expect(r!.matchType).toBe("phone");
  expect(r!.nameMatches).toEqual([]);
});
