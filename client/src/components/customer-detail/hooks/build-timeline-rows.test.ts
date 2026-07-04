import { describe, expect, test } from "vitest";

import type { Customer } from "@/data/customers";
import { buildTimelineRows } from "./useCustomerWorkflow";

const customer = {
  no: 20, customerId: "CU-2605-0020", receivedAt: "26/05/14 12:56", assignedAt: "26/05/14 13:04",
  team: "인천본사", name: "김민준", customerType: "개인", customerTypeDetail: "4대보험", phone: "010-1234-5678",
  vehicle: "Maybach S-Class", method: "운용리스", advisor: "김지안", statusGroup: "견적", status: "견적발송",
  date: "26/07/01 09:00", source: "앱 견적비교", talkCount: "", priority: "높음", nextAction: "재견적", aiSummary: "",
} as Customer;

const consultation = (id: string, occurredAt: string | null, summary: string, createdAt = "2026-06-01T10:00:00+09:00") =>
  ({ id, channel: "전화", summary, status: null, occurredAt, advisorId: null, createdAt });

describe("buildTimelineRows", () => {
  test("consultations 0행이면 기존 합성 4행 그대로(현행 렌더 무변화)", () => {
    const rows = buildTimelineRows(customer, []);
    expect(rows.map((r) => r.kind)).toEqual(["접수", "배정", "상태", "메모"]);
  });

  test("consultations는 배정 다음·상태 앞에 occurred_at 오름차순으로 삽입", () => {
    const rows = buildTimelineRows(customer, [
      consultation("b", "2026-06-20T10:00:00+09:00", "2차 상담"),
      consultation("a", "2026-06-10T10:00:00+09:00", "1차 상담"),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["접수", "배정", "상담", "상담", "상태", "메모"]);
    expect(rows[2].body).toBe("1차 상담");
    expect(rows[3].body).toBe("2차 상담");
  });

  test("occurred_at 없으면 created_at 폴백으로 정렬·표시", () => {
    const rows = buildTimelineRows(customer, [consultation("a", null, "시각 미기록", "2026-06-15T09:30:00+09:00")]);
    expect(rows[2].kind).toBe("상담");
    expect(rows[2].meta).toBe("26/06/15 09:30");
  });
});
