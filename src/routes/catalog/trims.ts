import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import {
  createTrim,
  deleteTrim,
  listTrimsByModel,
  moveTrims,
  reorderCatalog,
} from "../../db/queries/catalog-admin";
import { updateTrimWithDiscountAudit } from "../../db/queries/discount-adoptions";
import { visibleTrimsFor } from "../../lib/dealer-visibility";
import { requireRoles } from "../../middleware/role-gate";
import { stripDiscountProposal, submitChangeRequest } from "./change-request-kinds";
import { trimCreateBody, trimUpdateBody } from "./schemas";
import { type CatalogApp, id, run } from "./shared";

// /api/catalog/trims* — 트림 CRUD/순서/모델 이동.
//
// ⚠️ 큐 8종은 역할로 결말이 갈린다 — admin 즉시 실행 / manager 202 적재(spec §6.1).
// staff·dealer는 requireRoles가 403. 삭제·이동·reorder는 되돌리기 어렵거나(삭제) 전역/구조
// 영향(이동은 mc_code stale, 순서는 앱 노출)이라 admin 전용으로 더 좁게 닫는다(spec §3.2).
export function registerTrimRoutes(catalog: CatalogApp) {
  // reorder = 앱 노출 순서 전역 변경 — admin 전용(spec §3.2).
  catalog.post(
    "/trims/reorder",
    requireRoles(["admin"]),
    zValidator("json", z.object({ ids: z.array(id).min(1) })),
    async (c) =>
      run(c, async () => {
        await reorderCatalog("trims", c.req.valid("json").ids, c.var.db);
        return { ok: true };
      }),
  );

  // move = 모델 이동(mc_code stale 위험) — admin 전용(spec §3.2).
  // 트림 다른 모델로 이동(tx 원자 처리).
  catalog.post(
    "/trims/move",
    requireRoles(["admin"]),
    zValidator("json", z.object({ trimIds: z.array(id).min(1), targetModelId: id })),
    async (c) => {
      const { trimIds, targetModelId } = c.req.valid("json");
      return run(c, () => c.var.db.transaction((tx) => moveTrims(trimIds, targetModelId, tx)));
    },
  );

  catalog.get("/trims", zValidator("query", z.object({ modelId: id })), async (c) => {
    const trims = await listTrimsByModel(c.req.valid("query").modelId, c.var.db);
    // 딜러에게는 관리자 확정 할인을 내리지 않는다 — 자기 제안만 본다(lib/dealer-visibility 참조).
    const visible = visibleTrimsFor(c.var.user.role, trims);
    return c.json(visible.map((t) => ({ ...t, price: Number(t.price) })));
  });

  // 할인 3필드는 딜러 제안→관리자 채택 체계 소유(spec §3.1 정정 2026-07-31) — 팀장 제안에서
  // 서버가 제거한다(UI 숨김만으로는 API 직접 호출이 뚫린다 — 게이트 fail-closed 관례).
  // 부수 효과 둘: ①폼 오픈 시점 구 할인값이 payload에 실려 승인 replay가 그 사이 채택된 딜러
  // 할인을 되돌리는 사고 차단 ②snapshot에 할인 키가 안 실려 채택이 팀장 요청의 드리프트
  // 409를 유발하는 간섭 차단. admin 직접 실행은 계속 포함(채택 외 수동 조정 경로).
  // (구현은 change-request-kinds.ts 공용 — "이어서 수정" 교체 경로와 같은 규칙을 공유한다.)

  catalog.post("/trims", requireRoles(["admin", "manager"]), zValidator("json", trimCreateBody), async (c) => {
    const body = c.req.valid("json");
    if (c.var.user.role === "manager") return submitChangeRequest(c, "trim.create", null, stripDiscountProposal(body));
    return run(c, () => createTrim(body, c.var.db));
  });

  // 관리자 직접 편집 — 갱신 + 할인 3필드 감사 한 몸(근거·트랜잭션 필요성은
  // db/queries/discount-adoptions.ts의 updateTrimWithDiscountAudit 주석 참조, spec §3.4).
  // manager는 큐 적재(§6.1) — 감사는 승인 시점(approveChangeRequest → decidedBy)에 기록된다.
  catalog.patch(
    "/trims/:id",
    requireRoles(["admin", "manager"]),
    zValidator("param", z.object({ id })),
    zValidator("json", trimUpdateBody),
    async (c) => {
      const trimId = c.req.valid("param").id;
      const patch = c.req.valid("json");
      if (c.var.user.role === "manager") return submitChangeRequest(c, "trim.update", trimId, stripDiscountProposal(patch));
      const adoptedBy = c.var.user.id;
      return run(
        c,
        () => c.var.db.transaction((tx) => updateTrimWithDiscountAudit(trimId, patch, adoptedBy, tx)),
        "트림을 찾을 수 없습니다.",
      );
    },
  );

  // 삭제 = 파괴적(복구 경로 없음) — admin 전용(spec §3.2).
  catalog.delete("/trims/:id", requireRoles(["admin"]), zValidator("param", z.object({ id })), async (c) =>
    run(c, () => deleteTrim(c.req.valid("param").id, c.var.db), "트림을 찾을 수 없습니다."),
  );
}
