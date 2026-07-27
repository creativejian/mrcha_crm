import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { DISCOUNT_FIELDS } from "../../../client/src/lib/discount-adoption";
import { adoptDealerProposal, listModelProposals } from "../../db/queries/discount-adoptions";
import { requireRoles } from "../../middleware/role-gate";
import { type CatalogApp, id, run } from "./shared";

// 딜러 할인 제안 조회·채택(슬라이스 C) — **admin 전용**.
//
// ⚠️ requireRoles를 명시로 붙이는 이유: catalog 라우터에는 role 게이트가 없어서 staff도 카탈로그를
// 쓸 수 있는 상태다(기존 정책 — 이번에 바꾸지 않는다). 그 위에 그냥 얹으면 ①staff가 남의 딜러
// 제안을 열람하고 ②확정 할인을 채택할 수 있다. dealerWriteGate는 **쓰기만** 보므로 GET을 막지
// 않아 딜러가 경쟁사 제안을 들여다보는 경로도 열린다.
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §6.3·§7.2
// field 어휘는 client/src/lib/discount-adoption.ts가 SSOT다 — 여기 리터럴을 다시 적으면
// 스키마·쿼리·클라 팝오버가 어긋날 수 있다(어긋나도 타입은 통과한다).
const adoptBody = z.object({
  field: z.enum(DISCOUNT_FIELDS),
  dealerUserId: z.uuid(),
});

export function registerDiscountRoutes(catalog: CatalogApp) {
  // 모델 단위 조회 — 화면이 트림 표의 셀마다 "제안 있음" 단서를 달아야 하므로 목록 전체가
  // 한 번에 필요하다(트림 단위면 5시리즈 하나에 13번 왕복한다). 딜러 쪽
  // GET /api/dealer/discounts?modelId= 와 같은 축이다.
  catalog.get(
    "/models/:id/discount-proposals",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id })),
    async (c) => run(c, () => listModelProposals(c.req.valid("param").id, c.var.db)),
  );

  // 필드 단위 채택. **트랜잭션을 여기서 연다** — 쿼리 함수는 받은 executor를 그대로 쓰는 레포
  // 관례(updateQuote 선례)라 원자성이 호출자 책임이고, 확정 할인 갱신과 감사가 따로 커밋되면
  // "누가 바꿨는지 모르는 확정 할인"이 남는다(그 공백을 메우려고 만든 표다).
  //
  // 채택자(adopted_by)는 **클라가 보내지 않는다** — 세션의 c.var.user.id를 쓴다. 감사 주체를
  // 요청 본문에서 받으면 위조가 가능하고, 그 순간 감사가 감사가 아니게 된다.
  catalog.post(
    "/trims/:id/discount-adoptions",
    requireRoles(["admin"]),
    zValidator("param", z.object({ id })),
    zValidator("json", adoptBody),
    async (c) => {
      const { field, dealerUserId } = c.req.valid("json");
      const trimId = c.req.valid("param").id;
      const adoptedBy = c.var.user.id;
      return run(
        c,
        () => c.var.db.transaction((tx) => adoptDealerProposal({ trimId, field, dealerUserId, adoptedBy }, tx)),
        // null = 제안 없음 · 그 필드 미제안 · 제안자 자격 상실. 셋 다 "채택할 값이 없다"이고
        // 화면은 어느 쪽이든 목록을 새로 받으면 사실이 드러난다(사유를 나누지 않는다).
        "채택할 제안이 없습니다.",
      );
    },
  );
}
