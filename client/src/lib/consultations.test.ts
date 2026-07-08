import { afterEach, describe, expect, it, vi } from "vitest";

import { formatActivity } from "./customers";
import { fetchCustomerConsultations, toAppConsultation, type AppConsultationRow } from "./consultations";

// apiFetch(./api)가 supabase.auth.getSession()을 호출하므로 supabase를 mock한다.
vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const base: AppConsultationRow = {
  id: "c1",
  userId: "u1",
  customerName: "제임스",
  phoneNumber: "01012345678",
  carModel: "쏘렌토",
  notes: "가솔린 트림 견적 문의드립니다.",
  status: "pending",
  createdAt: "2026-06-25T04:02:34.633288+00:00",
};

describe("toAppConsultation", () => {
  it("carModel/notes를 그대로 통과시킨다", () => {
    const r = toAppConsultation(base);
    expect(r.id).toBe("c1");
    expect(r.carModel).toBe("쏘렌토");
    expect(r.notes).toBe("가솔린 트림 견적 문의드립니다.");
  });

  it("carModel/notes가 null이어도 그대로 null을 통과시킨다", () => {
    const r = toAppConsultation({ ...base, carModel: null, notes: null });
    expect(r.carModel).toBeNull();
    expect(r.notes).toBeNull();
  });

  it("dateLabel은 formatActivity(createdAt) 결과다", () => {
    const r = toAppConsultation(base);
    expect(r.dateLabel).toBe(formatActivity(base.createdAt));
  });
});

describe("fetchCustomerConsultations", () => {
  it("GET /api/customers/:id/consultations 호출 + 어댑터 적용", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify([base]), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const list = await fetchCustomerConsultations("cust-1");
    expect((spy.mock.calls[0] as unknown[])[0]).toBe("/api/customers/cust-1/consultations");
    expect(list).toHaveLength(1);
    expect(list[0].carModel).toBe("쏘렌토"); // toAppConsultation 적용 확인
  });

  it("빈 배열(수기 고객)은 빈 배열로 통과시킨다", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const list = await fetchCustomerConsultations("cust-2");
    expect(list).toEqual([]);
  });
});
