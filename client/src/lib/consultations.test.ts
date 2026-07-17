import { afterEach, describe, expect, it, vi } from "vitest";

import { formatActivity } from "./customers";
import {
  createCustomerFromConsultation,
  fetchCustomerConsultations,
  fetchPendingConsultations,
  linkConsultationToCustomer,
  toAppConsultation,
  type AppConsultationRow,
} from "./consultations";

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

describe("상담 신청 DB 인박스", () => {
  it("fetchPendingConsultations는 GET /api/consultations raw row를 그대로 반환한다", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify([base]), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const list = await fetchPendingConsultations();
    expect((spy.mock.calls[0] as unknown[])[0]).toBe("/api/consultations");
    expect(list[0].userId).toBe("u1"); // 어댑터 없이 raw(그룹핑 파생 입력)
  });

  it("linkConsultationToCustomer는 POST /:id/link + customerId body, 성공 후 인박스 재조회", async () => {
    const result = { id: "cust-9", customerCode: "CU-2607-0009", name: "송미진" };
    const spy = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify(result), { status: 200 })
        : new Response(JSON.stringify([]), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);
    const r = await linkConsultationToCustomer("c1", "cust-9");
    expect(r).toEqual(result);
    const [postUrl, postInit] = spy.mock.calls[0] as [string, RequestInit];
    expect(postUrl).toBe("/api/consultations/c1/link");
    expect(JSON.parse(String(postInit.body))).toEqual({ customerId: "cust-9" });
    // 승격 성공 후 인박스 목록 fresh 재조회(캐시 우회)까지가 계약.
    expect((spy.mock.calls[1] as unknown[])[0]).toBe("/api/consultations");
  });

  it("createCustomerFromConsultation은 POST /:id/create-customer, 성공 후 인박스 재조회", async () => {
    const result = { id: "cust-10", customerCode: "CU-2607-0010", name: "김지운" };
    const spy = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify(result), { status: 200 })
        : new Response(JSON.stringify([]), { status: 200 }),
    );
    vi.stubGlobal("fetch", spy);
    const r = await createCustomerFromConsultation("c2");
    expect(r).toEqual(result);
    expect((spy.mock.calls[0] as unknown[])[0]).toBe("/api/consultations/c2/create-customer");
    expect((spy.mock.calls[1] as unknown[])[0]).toBe("/api/consultations");
  });
});
