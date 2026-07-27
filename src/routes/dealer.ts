import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { listDealerProfiles, upsertDealerProfile } from "../db/queries/dealer-profiles";
import type { AuthVariables } from "../middleware/auth";
import type { DbVariables } from "../middleware/db";
import { requireRoles } from "../middleware/role-gate";

// /api/dealer/* — 딜러 도메인. 지금은 **관리자용 브랜드 매칭만**이다(슬라이스 A).
// 딜러 본인용 제안 입력(GET /me · PUT /discounts/:trimId)은 슬라이스 B에서 같은 라우터에 붙고,
// 그때만 dealerWriteGate allowlist에 그 경로 하나가 등록된다 — /profiles는 딜러에게 계속 닫힌다
// (자기 브랜드를 스스로 바꿀 수 있으면 브랜드 소유권 검증이 무의미해진다).
// spec: ref/specs/2026-07-27-crm-dealer-discount-proposal-design.md §6.3
export const dealer = new Hono<{ Variables: AuthVariables & DbVariables }>();

const userIdParam = z.object({ userId: z.uuid() });
// note는 딜러사명 한 줄("동성모터스"·"코오롱모터스"·"바바리안")이라 100자로 제한한다.
// 빈 문자열은 라우트에서 null로 정규화 — "미입력"과 같은 뜻을 두 값으로 저장하지 않는다.
const profileBody = z.object({
  brandId: z.number().int().positive(),
  note: z.string().trim().max(100).nullable().optional(),
});

dealer.get("/profiles", requireRoles(["admin"]), async (c) => c.json(await listDealerProfiles(c.var.db)));

dealer.put(
  "/profiles/:userId",
  requireRoles(["admin"]),
  zValidator("param", userIdParam),
  zValidator("json", profileBody),
  async (c) => {
    const { userId } = c.req.valid("param");
    const { brandId, note } = c.req.valid("json");
    const row = await upsertDealerProfile(
      { dealerUserId: userId, brandId, note: note?.length ? note : null },
      c.var.db,
    );
    return c.json(row);
  },
);
