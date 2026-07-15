import { describe, expect, test } from "vitest";

import { finalUpdateStatus } from "./customer-table";
import { isPreActionStatus } from "@/data/customers";

import { deriveFinalUpdateInfo, effectiveManageStatus, manualUpdateInfo, resolveUpdateBadge } from "./manage-status";

const NOW = new Date("2026-07-04T12:00:00+09:00");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const base = { recontacted: false, statusGroup: "상담중", status: "차량상담중" };

describe("deriveFinalUpdateInfo", () => {
  test("경과일 버킷 경계: 6=정상, 7=확인필요, 14=확인필요, 15=지연, 29=지연, 30=장기방치", () => {
    const labelAt = (days: number) =>
      finalUpdateStatus(deriveFinalUpdateInfo({ ...base, lastActivityAt: daysAgo(days) }, NOW)!).label;
    expect(labelAt(0)).toBe("정상");
    expect(labelAt(6)).toBe("정상");
    expect(labelAt(7)).toBe("확인필요");
    expect(labelAt(14)).toBe("확인필요");
    expect(labelAt(15)).toBe("지연");
    expect(labelAt(29)).toBe("지연");
    expect(labelAt(30)).toBe("장기방치");
  });

  test("recontacted면 기간 무관 재문의", () => {
    const info = deriveFinalUpdateInfo({ ...base, recontacted: true, lastActivityAt: daysAgo(40) }, NOW)!;
    expect(finalUpdateStatus(info).label).toBe("재문의");
  });

  test("신규+상담접수(액션 전)는 null → 공백", () => {
    expect(deriveFinalUpdateInfo({ ...base, statusGroup: "신규", status: "상담접수", lastActivityAt: daysAgo(1) }, NOW)).toBeNull();
  });

  test("lastActivityAt 없음/파싱 불가면 null", () => {
    expect(deriveFinalUpdateInfo({ ...base, lastActivityAt: null }, NOW)).toBeNull();
    expect(deriveFinalUpdateInfo({ ...base, lastActivityAt: "not-a-date" }, NOW)).toBeNull();
  });

  test("label은 기존 mock 포맷('N월 N일 HH:mm') — 목록 응답 SLA 파서 호환", () => {
    const info = deriveFinalUpdateInfo({ ...base, lastActivityAt: "2026-07-01T09:05:00+09:00" }, NOW)!;
    expect(info.label).toBe("7월 1일 09:05");
    expect(info.days).toBe(3);
    expect(info.atIso).toBe(new Date("2026-07-01T09:05:00+09:00").toISOString());
  });

  test("days는 달력일 차이 — 어제 23시 활동 + 오늘 01시 현재 = 1일", () => {
    const info = deriveFinalUpdateInfo({ ...base, lastActivityAt: "2026-07-03T23:00:00+09:00" }, new Date("2026-07-04T01:00:00+09:00"))!;
    expect(info.days).toBe(1);
  });

  test("미래 시각(시계 오차)은 days 0으로 클램프", () => {
    const info = deriveFinalUpdateInfo({ ...base, lastActivityAt: daysAgo(-1) }, NOW)!;
    expect(info.days).toBe(0);
  });
});

// override 합성 규칙 SSOT — 목록 필터·행 렌더·상세 워크플로우 3곳이 공유(한쪽만 픽스되는 드리프트 방지).
describe("resolveUpdateBadge", () => {
  const source = { ...base, lastActivityAt: daysAgo(2) };

  test("override 없음: 파생 info + 그 버킷 status", () => {
    const { info, status } = resolveUpdateBadge(source, { now: NOW });
    expect(info?.days).toBe(2);
    expect(status?.label).toBe("정상");
  });

  test("finalUpdateOverride가 파생을 대체(방금 전 갱신 마킹)", () => {
    const override = { action: "상담 메모 업데이트", label: "방금 전", days: 0 };
    const { info, status } = resolveUpdateBadge(source, { finalUpdateOverride: override, now: NOW });
    expect(info).toBe(override);
    expect(status?.label).toBe("정상");
  });

  test("수동 관리 상태는 row 필드가 단일 소스 — 유효(동일 스탬프)면 info 버킷과 무관하게 status 결정", () => {
    // 구 manageStatusOverride 옵션은 폐기(0713 — 삭제 경로가 없어 만료·리로드를 가리던 이중 소스).
    // 낙관 반영도 App이 row의 manageStatus/manageStatusAt을 직접 갱신한다(applyWorkflowRowUpdate).
    const at = source.lastActivityAt;
    const { status } = resolveUpdateBadge({ ...source, manageStatus: "지연", manageStatusAt: at }, { now: NOW });
    expect(status?.label).toBe("지연");
  });

  test("파생 불가(신규·상담접수)면 둘 다 null", () => {
    const { info, status } = resolveUpdateBadge({ ...source, statusGroup: "신규", status: "상담접수" }, { now: NOW });
    expect(info).toBeNull();
    expect(status).toBeNull();
  });
});

// 수동 관리 상태 영속(이사님 2026-07-13 ⑦-①) — 스누즈 유효 판정과 배지 우선순위.
// 서버 동치(activity.manualManageStatusActive)는 manage-status-parity.test.ts가 잠근다.
describe("effectiveManageStatus (스누즈)", () => {
  test("manage_status_at >= 활동시각이면 유효(동시 = PATCH 동일 스탬프 계약 포함)", () => {
    const at = daysAgo(2);
    expect(effectiveManageStatus({ ...base, lastActivityAt: at, manageStatus: "지연", manageStatusAt: at })).toBe("지연");
    expect(effectiveManageStatus({ ...base, lastActivityAt: daysAgo(5), manageStatus: "정상", manageStatusAt: daysAgo(2) })).toBe("정상");
  });

  test("이후 실활동이 기록되면 만료(파생 복귀) — 활동시각 > manage_status_at", () => {
    expect(effectiveManageStatus({ ...base, lastActivityAt: daysAgo(1), manageStatus: "정상", manageStatusAt: daysAgo(3) })).toBeNull();
  });

  test("값·스탬프 없으면 null(파싱 불가 스탬프 포함)", () => {
    expect(effectiveManageStatus({ ...base, lastActivityAt: daysAgo(1) })).toBeNull();
    expect(effectiveManageStatus({ ...base, lastActivityAt: daysAgo(1), manageStatus: "정상", manageStatusAt: null })).toBeNull();
    expect(effectiveManageStatus({ ...base, lastActivityAt: daysAgo(1), manageStatus: "정상", manageStatusAt: "파싱불가" })).toBeNull();
  });

  test("활동시각이 없으면(활동 전 수동 설정) 유효", () => {
    expect(effectiveManageStatus({ ...base, lastActivityAt: null, manageStatus: "확인필요", manageStatusAt: daysAgo(1) })).toBe("확인필요");
  });
});

describe("resolveUpdateBadge — 서버 영속 수동 상태 반영", () => {
  test("유효한 영속 수동 상태가 파생 버킷을 이긴다(리로드 후에도 배지 유지 = 영속화의 목적)", () => {
    const at = daysAgo(10); // 파생이면 확인필요(10일)
    const { status } = resolveUpdateBadge({ ...base, lastActivityAt: at, manageStatus: "정상", manageStatusAt: at }, { now: NOW });
    expect(status?.label).toBe("정상");
  });

  test("만료된 영속 수동 상태는 무시 — 파생 버킷 복귀", () => {
    const { status } = resolveUpdateBadge(
      { ...base, lastActivityAt: daysAgo(10), manageStatus: "정상", manageStatusAt: daysAgo(20) },
      { now: NOW },
    );
    expect(status?.label).toBe("확인필요");
  });

  test("낙관 반영(방금 선택)도 row 갱신으로 표현 — 새 값+동일 now 스탬프가 이전 영속값을 대체", () => {
    const { status } = resolveUpdateBadge(
      { ...base, lastActivityAt: daysAgo(0), manageStatus: "지연", manageStatusAt: daysAgo(0) },
      { now: NOW },
    );
    expect(status?.label).toBe("지연");
  });

  test("유효 영속 재문의 — recontacted 없이도 재문의 배지(전화 재문의 수동 마킹 경로)", () => {
    const at = daysAgo(3);
    const { status } = resolveUpdateBadge({ ...base, lastActivityAt: at, manageStatus: "재문의", manageStatusAt: at }, { now: NOW });
    expect(status?.label).toBe("재문의");
  });

  test("신규·상담접수 + 유효 수동 = status는 수동값, info는 null(파생 공백 유지 — 셀이 manualUpdateInfo로 폴백)", () => {
    const at = daysAgo(0);
    const { info, status } = resolveUpdateBadge(
      { ...base, statusGroup: "신규", status: "상담접수", lastActivityAt: at, manageStatus: "지연", manageStatusAt: at },
      { now: NOW },
    );
    expect(status?.label).toBe("지연");
    expect(info).toBeNull();
  });
});

// 3-A: 액션 전 상태 게이트 — 클라(deriveFinalUpdateInfo)와 서버(assistant-tools stale_customers)가 공유하는
// 단일 함수(리터럴 이중 정의 제거). 여기서 계약을 명시 잠금해 한쪽만 바뀌는 드리프트를 막는다.
describe("isPreActionStatus (액션 전 상태 게이트 SSOT)", () => {
  test("신규·상담접수만 true", () => {
    expect(isPreActionStatus("신규", "상담접수")).toBe(true);
    expect(isPreActionStatus("신규", "1차부재중")).toBe(false);
    expect(isPreActionStatus("상담중", "상담접수")).toBe(false);
    expect(isPreActionStatus(null, null)).toBe(false); // 서버 nullable 컬럼 방어
  });
});

// 3-C: 셀 표시 단일 값 — status와 팝오버 info를 두 지점(resolveUpdateBadge·셀의 manualUpdateInfo
// 재계산)에서 customer를 각각 읽어 "우연히 일치"하던 결합 해소. info(응답 SLA firstResponseDisplay의
// 입력)는 #240 계약대로 null 유지 — 수동 지정은 고객 응대가 아니므로 SLA "대기 중"이 유지돼야 한다.
describe("resolveUpdateBadge.displayInfo (셀 표시 단일 값, 3-C)", () => {
  const source = { ...base, lastActivityAt: daysAgo(2) };

  test("파생 info가 있으면 displayInfo는 info 그대로(동일 참조)", () => {
    const { info, displayInfo } = resolveUpdateBadge(source, { now: NOW });
    expect(displayInfo).toBe(info);
    expect(displayInfo?.days).toBe(2);
  });

  test("신규·상담접수 + 유효 수동: info는 null 유지(SLA 계약), displayInfo는 수동 지정 합성", () => {
    const at = daysAgo(0);
    const { info, displayInfo } = resolveUpdateBadge(
      { ...base, statusGroup: "신규", status: "상담접수", lastActivityAt: at, manageStatus: "지연", manageStatusAt: at },
      { now: NOW },
    );
    expect(info).toBeNull();
    expect(displayInfo?.action).toBe("관리 상태 수동 지정");
    expect(displayInfo?.atIso).toBe(at);
  });

  test("finalUpdateOverride(방금 전 마킹)도 displayInfo로 그대로 노출", () => {
    const override = { action: "상담 메모 업데이트", label: "방금 전", days: 0 };
    const { displayInfo } = resolveUpdateBadge(source, { finalUpdateOverride: override, now: NOW });
    expect(displayInfo).toBe(override);
  });

  test("만료 수동 + 파생 info면 displayInfo는 파생(수동 미개입)", () => {
    const { info, displayInfo } = resolveUpdateBadge(
      { ...source, manageStatus: "지연", manageStatusAt: daysAgo(5) },
      { now: NOW },
    );
    expect(displayInfo).toBe(info);
    expect(displayInfo?.action).toBe("최근 활동 업데이트");
  });

  test("파생·수동 모두 없으면 null(공백 셀)", () => {
    const { displayInfo } = resolveUpdateBadge({ ...base, statusGroup: "신규", status: "상담접수", lastActivityAt: daysAgo(1) }, { now: NOW });
    expect(displayInfo).toBeNull();
  });
});

describe("manualUpdateInfo — 수동 배지 팝오버 폴백(배치 4 B2 기각 번복 2026-07-14)", () => {
  test("유효 수동이면 manageStatusAt 기반 info 합성 — 액션 '관리 상태 수동 지정'", () => {
    const at = daysAgo(2);
    const info = manualUpdateInfo({ ...base, statusGroup: "신규", status: "상담접수", lastActivityAt: at, manageStatus: "지연", manageStatusAt: at }, NOW)!;
    expect(info.action).toBe("관리 상태 수동 지정");
    expect(info.atIso).toBe(at);
    expect(info.days).toBe(2);
  });

  test("만료 수동(실활동이 더 최신)은 null — 유효 판정을 effectiveManageStatus와 공유", () => {
    expect(manualUpdateInfo({ ...base, lastActivityAt: daysAgo(1), manageStatus: "지연", manageStatusAt: daysAgo(5) }, NOW)).toBeNull();
  });

  test("수동 미설정은 null", () => {
    expect(manualUpdateInfo({ ...base, lastActivityAt: daysAgo(1) }, NOW)).toBeNull();
  });
});
