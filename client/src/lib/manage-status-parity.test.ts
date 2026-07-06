import { expect, test } from "vitest";

// 서버 모듈 테스트 전용 import(quick-prompt-tools 파리티와 동일 패턴) — 런타임 번들에는 유입되지 않는다.
import { STALE_THRESHOLDS } from "../../../src/db/queries/activity";

import { finalUpdateStatus, type FinalUpdateInfo } from "./customer-table";

// 관리 상태 버킷 임계 파리티 — 서버 도구(stale_customers/delivery_risk)와 클라 목록 배지가 같은 달력일
// 임계를 봐야 "응답 지연" 리포트와 화면 배지가 모순되지 않는다(0706 배치 B — 활동 파생 seam).
const info = (days: number): FinalUpdateInfo => ({ action: "", label: "", atIso: "", days });

test("서버 STALE_THRESHOLDS ↔ 클라 finalUpdateStatus 버킷 경계 일치", () => {
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.review - 1)).label).toBe("정상");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.review)).label).toBe("확인필요");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.delayed - 1)).label).toBe("확인필요");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.delayed)).label).toBe("지연");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.abandoned - 1)).label).toBe("지연");
  expect(finalUpdateStatus(info(STALE_THRESHOLDS.abandoned)).label).toBe("장기방치");
});
