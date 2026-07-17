import { describe, expect, it } from "vitest";

import type { Customer } from "@/data/customers";
import type { AppConsultationRow } from "./consultations";
import { buildConsultationInboxGroups } from "./consultation-inbox";

// 그룹핑·매칭 파생은 순수 계층 — 실제 목록 fetch/액션은 페이지가 담당한다.

function row(overrides: Partial<AppConsultationRow> = {}): AppConsultationRow {
  return {
    id: "c1",
    userId: "u1",
    customerName: "송미진",
    phoneNumber: "01011112222",
    carModel: "쏘렌토",
    notes: "리스 상담 원합니다.",
    status: "pending",
    createdAt: "2026-07-10T04:00:00.000+00:00",
    ...overrides,
  };
}

// Customer는 필드가 많아 매칭에 쓰는 것만 채운 최소 픽스처(no·name 등은 더미).
function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-uuid-1",
    appUserId: null,
    no: 1,
    customerId: "CU-2607-0001",
    receivedAt: "",
    assignedAt: "",
    team: "",
    name: "박서연",
    customerType: "",
    customerTypeDetail: "",
    phone: "010-1111-2222",
    vehicle: "",
    method: "",
    advisor: "미배정",
    statusGroup: "신규",
    status: "상담접수",
    date: "",
    source: "",
    talkCount: "",
    priority: "",
    nextAction: "",
    aiSummary: "",
    ...overrides,
  };
}

describe("buildConsultationInboxGroups — 그룹핑", () => {
  it("같은 userId 상담을 1행으로 묶고 건수를 센다", () => {
    const groups = buildConsultationInboxGroups(
      [
        row({ id: "a", createdAt: "2026-07-10T04:00:00.000+00:00" }),
        row({ id: "b", createdAt: "2026-07-11T04:00:00.000+00:00" }),
        row({ id: "c", userId: "u2", customerName: "김지운", phoneNumber: "01033334444" }),
      ],
      [],
    );
    expect(groups).toHaveLength(2);
    const u1 = groups.find((g) => g.userId === "u1");
    expect(u1?.count).toBe(2);
    expect(groups.find((g) => g.userId === "u2")?.count).toBe(1);
  });

  it("그룹 정렬은 최근 상담 desc, 그룹 내 개별 상담도 desc", () => {
    const groups = buildConsultationInboxGroups(
      [
        row({ id: "old", userId: "u1", createdAt: "2026-07-01T00:00:00.000+00:00" }),
        row({ id: "newest", userId: "u2", customerName: "김지운", createdAt: "2026-07-12T00:00:00.000+00:00" }),
        row({ id: "mid", userId: "u1", createdAt: "2026-07-05T00:00:00.000+00:00" }),
      ],
      [],
    );
    expect(groups.map((g) => g.userId)).toEqual(["u2", "u1"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["mid", "old"]);
  });

  it("이름·연락처·최근 상담일·대표 상담 id는 최신 상담(폼 최신값) 기준", () => {
    const [g] = buildConsultationInboxGroups(
      [
        row({ id: "old", customerName: "송미진(구)", phoneNumber: "01011112222", createdAt: "2026-07-01T00:00:00.000+00:00" }),
        row({ id: "new", customerName: "송미진", phoneNumber: "01099998888", createdAt: "2026-07-11T00:00:00.000+00:00" }),
      ],
      [],
    );
    expect(g.name).toBe("송미진");
    expect(g.phoneLabel).toBe("010-9999-8888"); // formatPhone 표시 포맷
    expect(g.latestConsultationId).toBe("new");
    expect(g.count).toBe(2);
  });

  it("최근 문의 미리보기는 최신 것부터 찾은 비어있지 않은 notes(최신이 null이면 이전 것)", () => {
    const [g] = buildConsultationInboxGroups(
      [
        row({ id: "old", notes: "옛 문의", createdAt: "2026-07-01T00:00:00.000+00:00" }),
        row({ id: "new", notes: null, createdAt: "2026-07-11T00:00:00.000+00:00" }),
      ],
      [],
    );
    expect(g.previewNotes).toBe("옛 문의");
  });

  it("notes가 전부 비면 previewNotes는 null", () => {
    const [g] = buildConsultationInboxGroups([row({ notes: null }), row({ id: "c2", notes: "  " })], []);
    expect(g.previewNotes).toBeNull();
  });

  it("userId null 상담은 전화번호로 묶고 canPromote=false(link/create 라우트가 userId 필수)", () => {
    const groups = buildConsultationInboxGroups(
      [
        row({ id: "a", userId: null, phoneNumber: "01055556666" }),
        row({ id: "b", userId: null, phoneNumber: "01055556666" }),
        row({ id: "c", userId: null, phoneNumber: "01077778888" }),
      ],
      [],
    );
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.canPromote === false)).toBe(true);
    const withUser = buildConsultationInboxGroups([row()], []);
    expect(withUser[0].canPromote).toBe(true);
  });
});

describe("buildConsultationInboxGroups — 매칭 파생(견적요청 인박스 미러)", () => {
  it("app_user 연결: customers.appUserId 일치 → 연결됨 배지 + 고객 코드", () => {
    const [g] = buildConsultationInboxGroups(
      [row({ userId: "u1" })],
      [customer({ id: "cust-1", appUserId: "u1", name: "송미진", customerId: "CU-2607-0009" })],
    );
    expect(g.matchType).toBe("app_user");
    expect(g.matchLabel).toBe("연결됨 송미진");
    expect(g.matchedCustomerCode).toBe("CU-2607-0009");
    expect(g.matchedCustomerId).toBe("cust-1");
  });

  it("전화 일치: 하이픈 표시 포맷 고객 phone과 숫자만 phoneNumber를 정규화 비교", () => {
    const [g] = buildConsultationInboxGroups(
      [row({ userId: "u1", phoneNumber: "01011112222" })],
      [customer({ id: "cust-2", appUserId: null, name: "박서연", phone: "010-1111-2222" })],
    );
    expect(g.matchType).toBe("phone");
    expect(g.matchLabel).toBe("기존 고객 박서연(추정)");
    expect(g.matchedCustomerId).toBe("cust-2");
  });

  it("app_user 매칭이 전화 매칭보다 우선한다", () => {
    const [g] = buildConsultationInboxGroups(
      [row({ userId: "u1", phoneNumber: "01011112222" })],
      [
        customer({ id: "cust-phone", appUserId: null, name: "전화고객", phone: "010-1111-2222" }),
        customer({ id: "cust-app", appUserId: "u1", name: "앱고객", phone: "010-0000-0000" }),
      ],
    );
    expect(g.matchType).toBe("app_user");
    expect(g.matchedCustomerId).toBe("cust-app");
  });

  it("앱 연결 고객은 phone 매칭 후보에서 제외한다(합성 phone = 앱 번호 — 2026-07-17 spec §3-6)", () => {
    // 다른 유저(u2)의 상담인데 전화가 "이미 u1에 연결된 고객"의 표시 phone과 같다(가족 공유 번호).
    // 그 고객을 후보로 잡으면 link 시 역방향 409로만 막히는 오매칭 — 후보에서 아예 빠져야 한다.
    const [g] = buildConsultationInboxGroups(
      [row({ userId: "u2", phoneNumber: "01011112222" })],
      [customer({ id: "cust-linked", appUserId: "u1", name: "연결고객", phone: "010-1111-2222" })],
    );
    expect(g.matchType).toBe("none");
    expect(g.matchedCustomerId).toBeNull();
  });

  it("매칭 없음 → none + 신규(미연결) 라벨", () => {
    const [g] = buildConsultationInboxGroups([row()], [customer({ id: "x", phone: "010-9999-0000" })]);
    expect(g.matchType).toBe("none");
    expect(g.matchLabel).toBe("신규(미연결)");
    expect(g.matchedCustomerId).toBeNull();
  });

  it("id 없는 고객(목업 행)은 매칭 후보에서 제외한다", () => {
    const [g] = buildConsultationInboxGroups(
      [row({ phoneNumber: "01011112222" })],
      [customer({ id: undefined, phone: "010-1111-2222" })],
    );
    expect(g.matchType).toBe("none");
  });

  it("phone이 빈 고객은 전화 매칭 키를 만들지 않는다(빈 문자열끼리 오매칭 방지)", () => {
    const [g] = buildConsultationInboxGroups(
      [row({ phoneNumber: "" })],
      [customer({ id: "cust-3", phone: "" })],
    );
    expect(g.matchType).toBe("none");
  });
});
