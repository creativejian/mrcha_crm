import { describe, expect, test } from "vitest";

import type { Customer } from "@/data/customers";
import { applyWorkflowRowUpdate, buildWorkflowPatch } from "./customer-workflow";
import { effectiveManageStatus } from "./manage-status";

const NOW_ISO = "2026-07-13T12:00:00.000Z";
const daysAgoIso = (days: number) => new Date(new Date(NOW_ISO).getTime() - days * 86_400_000).toISOString();

const baseCustomer: Customer = {
  id: "c-1",
  no: 20,
  customerId: "CU-2605-0020",
  receivedAt: "",
  assignedAt: "",
  team: "",
  name: "김민준",
  customerType: "",
  customerTypeDetail: "",
  phone: "",
  vehicle: "",
  method: "",
  advisor: "",
  statusGroup: "상담중",
  status: "차량상담중",
  date: "26/07/01 09:00",
  source: "",
  talkCount: "",
  priority: "",
  nextAction: "",
  aiSummary: "",
  lastActivityAt: daysAgoIso(10),
  manageStatus: null,
  manageStatusAt: null,
};

// App.updateCustomerWorkflow의 PATCH 구성 규칙 잠금(0713 감사 — 무테스트였던 경로).
describe("buildWorkflowPatch", () => {
  test("statusGroup/status/manageStatus는 전달분만 실린다", () => {
    expect(buildWorkflowPatch({ status: "견적상담중" }, { contracted: false, wasConfirmed: false })).toEqual({ status: "견적상담중" });
    expect(buildWorkflowPatch({ manageStatus: "지연" }, { contracted: false, wasConfirmed: false })).toEqual({ manageStatus: "지연" });
  });

  test("계약완료면 chance는 무조건 확정(Option A) — 전달 chance 무시", () => {
    expect(buildWorkflowPatch({ statusGroup: "계약완료", status: "출고완료", chance: "중간" }, { contracted: true, wasConfirmed: false }))
      .toEqual({ statusGroup: "계약완료", status: "출고완료", chance: "확정" });
  });

  test("계약완료 이탈(statusGroup 변경 + 기존 확정)이면 chance는 null 해제", () => {
    expect(buildWorkflowPatch({ statusGroup: "상담중", status: "차량상담중" }, { contracted: false, wasConfirmed: true }))
      .toEqual({ statusGroup: "상담중", status: "차량상담중", chance: null });
  });

  test("비계약완료 chance 변경은 그대로 실린다", () => {
    expect(buildWorkflowPatch({ chance: "높음" }, { contracted: false, wasConfirmed: false })).toEqual({ chance: "높음" });
  });

  test("빈 next면 빈 patch(PATCH 미발송 조건)", () => {
    expect(buildWorkflowPatch({}, { contracted: false, wasConfirmed: false })).toEqual({});
  });
});

// 낙관 row 반영 — 수동 관리 상태의 단일 소스는 row(manageStatus/manageStatusAt)다(#228 이중 소스 폐기).
describe("applyWorkflowRowUpdate", () => {
  test("manageStatus 변경: manageStatusAt=lastActivityAt=nowIso 동일 스탬프 → effectiveManageStatus 즉시 유효(서버 동일 now 계약 미러)", () => {
    const updated = applyWorkflowRowUpdate(baseCustomer, { manageStatus: "지연" }, { nowIso: NOW_ISO, willPatch: true });
    expect(updated.manageStatus).toBe("지연");
    expect(updated.manageStatusAt).toBe(NOW_ISO);
    expect(updated.lastActivityAt).toBe(NOW_ISO);
    expect(effectiveManageStatus(updated)).toBe("지연");
  });

  test("status 변경(PATCH 발송): lastActivityAt bump로 기존 유효 수동 상태가 만료된다(서버 updated_at bump 동치 — 0713 감사 1-C)", () => {
    const withManual: Customer = { ...baseCustomer, manageStatus: "장기방치", manageStatusAt: baseCustomer.lastActivityAt };
    expect(effectiveManageStatus(withManual)).toBe("장기방치"); // 전제: 변경 전 유효
    const updated = applyWorkflowRowUpdate(withManual, { status: "견적상담중" }, { nowIso: NOW_ISO, willPatch: true });
    expect(updated.status).toBe("견적상담중");
    expect(updated.date).toBe("방금 전");
    expect(updated.lastActivityAt).toBe(NOW_ISO);
    expect(effectiveManageStatus(updated)).toBeNull(); // 만료 — 파생 복귀
  });

  test("willPatch=false(목업 행 등 PATCH 미발송)면 lastActivityAt은 건드리지 않는다", () => {
    const updated = applyWorkflowRowUpdate(baseCustomer, { status: "견적상담중" }, { nowIso: NOW_ISO, willPatch: false });
    expect(updated.lastActivityAt).toBe(baseCustomer.lastActivityAt);
    expect(updated.date).toBe("방금 전"); // 낙관 표시는 유지(기존 행위)
  });

  test("statusGroup 미전달 status 변경은 기존 statusGroup 유지, 원본 불변(rollback은 스냅샷 복원)", () => {
    const updated = applyWorkflowRowUpdate(baseCustomer, { status: "견적상담중" }, { nowIso: NOW_ISO, willPatch: true });
    expect(updated.statusGroup).toBe("상담중");
    expect(baseCustomer.status).toBe("차량상담중");
    expect(baseCustomer.lastActivityAt).toBe(daysAgoIso(10));
  });

  test("chance-only 변경도 PATCH가 나가면 lastActivityAt bump(서버가 updated_at을 bump해 스누즈를 만료시키는 것과 동치)", () => {
    const withManual: Customer = { ...baseCustomer, manageStatus: "재문의", manageStatusAt: baseCustomer.lastActivityAt };
    const updated = applyWorkflowRowUpdate(withManual, { chance: "높음" }, { nowIso: NOW_ISO, willPatch: true });
    expect(updated.lastActivityAt).toBe(NOW_ISO);
    expect(effectiveManageStatus(updated)).toBeNull();
    expect(updated.statusGroup).toBe("상담중"); // 진행 상태는 불변
    expect(updated.status).toBe("차량상담중");
  });
});
