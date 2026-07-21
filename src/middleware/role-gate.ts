import type { MiddlewareHandler } from "hono";

import type { AuthVariables } from "./auth";

// dealer는 읽기 전용 역할 — 쓰기 메서드를 전역에서 403으로 차단한다(fail-closed).
// UI는 딜러에게 쓰기 버튼을 숨기지만 API 직접 호출은 열려 있었다(2026-07-11 스캔:
// 쓰기 라우트 29개 중 role 게이트 2개뿐 — 메모/할일/일정/견적/서류 삭제 등 무게이트).
// 역할별 세분 정책(admin/staff 매트릭스)은 별도 슬라이스 — 이 게이트는 dealer 축만 담당.

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export type DealerWriteAllowEntry = { method: string; path: RegExp };

// 딜러의 정당한 쓰기가 생기면 여기 등록해 라우트 단위로 연다. 정규식은 반드시 ^…$ 앵커
// (부분 일치로 이웃 라우트가 새는 것 방지 — role-gate.test.ts가 잠금).
// 확정 예정 1건(2026-07-11 이사님·유슨생): MC 마스터 트림 할인 입력(자사/제휴/타사) —
// 딜러용 라우트 신설 시 { method, path: /^\/api\/catalog\/…$/ } 형태로 추가.
export const DEALER_WRITE_ALLOWLIST: DealerWriteAllowEntry[] = [];

export function isDealerWriteAllowed(
  method: string,
  path: string,
  allowlist: readonly DealerWriteAllowEntry[],
): boolean {
  return allowlist.some((entry) => entry.method === method && entry.path.test(path));
}

// 허용 role 화이트리스트 게이트(fail-closed 403) — 라우터 단위로 건다.
// 첫 소비처 = 인박스 2종(상담 신청 DB·앱 견적요청, 2026-07-21 유슨생 결정·pending 항목 16):
// 인박스는 "미배정 신규 유입 큐"라 미배정 고객을 볼 수 있는 admin·manager(#301 D-3① 미러) 전용.
// 읽기까지 차단한다(승격만 막으면 전 앱 유저 요청·전화번호 열람이 남고, 상담 인박스 클라 매칭이
// 스코프된 고객 목록으로 "신규"를 오판해 중복 고객을 만들 수 있다 — role scope spec §4).
export function requireRoles(allowed: readonly string[]): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    if (!allowed.includes(c.var.user.role)) return c.json({ error: "권한이 없습니다." }, 403);
    await next();
  };
}

export const dealerWriteGate: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  if (WRITE_METHODS.has(c.req.method) && c.var.user.role === "dealer") {
    if (!isDealerWriteAllowed(c.req.method, c.req.path, DEALER_WRITE_ALLOWLIST)) {
      return c.json({ error: "권한이 없습니다." }, 403);
    }
  }
  await next();
};
