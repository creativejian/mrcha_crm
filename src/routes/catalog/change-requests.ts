import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  cancelOwnPending, listChangeRequests, listModelPendingRequests, listMyChangeRequests, markRejected,
} from "../../db/queries/change-requests";
import { requireRoles } from "../../middleware/role-gate";
import { approveChangeRequest, replaceOwnChangeRequest } from "./change-request-kinds";
import { type CatalogApp, id, run } from "./shared";

// 변경 요청 대기열(spec §6.3) — 목록·승인·반려는 admin, 내 요청·취소·교체(PUT)는 요청자 본인.
// 승인은 트랜잭션 하나(선점→재검증→드리프트→replay) — approveChangeRequest 주석 참조.
const listQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "canceled"]).default("pending"),
  mine: z.literal("1").optional(), // "1"만 유효 — 다른 값은 400(오탈자가 조용히 admin 분기로 새지 않게)
});

export function registerChangeRequestRoutes(catalog: CatalogApp) {
  catalog.get("/change-requests", requireRoles(["admin", "manager"]), zValidator("query", listQuery), async (c) => {
    const { status, mine } = c.req.valid("query");
    if (mine === "1") return c.json(await listMyChangeRequests(c.var.user.id, c.var.db));
    // 전체 대기열은 admin 전용 — manager가 mine 없이 부르면 타인 요청까지 보인다.
    if (c.var.user.role !== "admin") return c.json({ error: "권한이 없습니다." }, 403);
    return c.json(await listChangeRequests(status, c.var.db));
  });

  catalog.post(
    "/change-requests/:id/approve",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id: z.uuid() })),
    async (c) => {
      const decidedBy = c.var.user.id;
      return run(
        c,
        () => c.var.db.transaction((tx) => approveChangeRequest(c.req.valid("param").id, decidedBy, tx)),
        "대기 중인 요청이 없습니다.",
      );
    },
  );

  catalog.post(
    "/change-requests/:id/reject",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id: z.uuid() })),
    zValidator("json", z.object({ reason: z.string().min(1) })),
    async (c) =>
      run(
        c,
        () => markRejected(c.req.valid("param").id, c.req.valid("json").reason, c.var.user.id, c.var.db),
        "대기 중인 요청이 없습니다.",
      ),
  );

  catalog.delete(
    "/change-requests/:id",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id: z.uuid() })),
    async (c) =>
      run(c, () => cancelOwnPending(c.req.valid("param").id, c.var.user.id, c.var.db), "취소할 대기 요청이 없습니다."),
  );

  // 내 pending 요청 "이어서 수정"(2026-08-03) — payload 통째 교체. 본문은 kind별 bodySchema로
  // 핸들러 안에서 파싱한다(kind가 행에 있어 라우트 시점엔 스키마를 못 고른다 — 여기 zValidator는
  // JSON 객체 형태만 보장). 게이트는 취소(DELETE)와 동일 — 소유는 핸들러가 강제한다.
  catalog.put(
    "/change-requests/:id",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id: z.uuid() })),
    zValidator("json", z.record(z.string(), z.unknown())),
    async (c) => replaceOwnChangeRequest(c, c.req.valid("param").id, c.req.valid("json")),
  );

  catalog.get(
    "/models/:id/change-requests",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    async (c) => c.json(await listModelPendingRequests(c.req.valid("param").id, c.var.db)),
  );
}
