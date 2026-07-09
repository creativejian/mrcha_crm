import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { createCustomerFromRequest, getQuoteRequestDetail, linkRequestToCustomer, listQuoteRequests } from "../db/queries/quote-requests";
import { scheduleEmbedOnWrite } from "../lib/embed-on-write";
import { promotionEmbedJobs } from "../lib/promotion-embeds";
import type { DbVariables } from "../middleware/db";
import { run } from "./shared";

export const quoteRequests = new Hono<{ Variables: DbVariables }>();

const idParam = z.object({ id: z.uuid() });

// 승격/연결 시점 임베딩 훅 — job 목록은 promotion-embeds SSOT(상담신청 라우트와 공유).
async function schedulePromotionEmbeds(
  c: Context<{ Variables: DbVariables }>,
  opts: { appUserId: string; customerId?: string },
): Promise<void> {
  for (const job of await promotionEmbedJobs(opts, c.var.db)) scheduleEmbedOnWrite(c, job);
}

quoteRequests.get("/", (c) => run(c, () => listQuoteRequests(c.var.db)));

// prefill용 단건(차량·구매방식·옵션ids). 없으면 404.
quoteRequests.get("/:id", zValidator("param", idParam), (c) =>
  run(c, () => getQuoteRequestDetail(c.req.valid("param").id, c.var.db), "요청을 찾을 수 없습니다."),
);

// 전화 매칭된 기존 고객에 연결(app_user_id set).
quoteRequests.post(
  "/:id/link",
  zValidator("param", idParam),
  zValidator("json", z.object({ customerId: z.uuid() })),
  (c) =>
    run(
      c,
      async () => {
        const row = await linkRequestToCustomer(c.req.valid("param").id, c.req.valid("json").customerId, c.var.db);
        if (row) await schedulePromotionEmbeds(c, { appUserId: row.appUserId });
        return row;
      },
      "요청 또는 고객을 찾을 수 없습니다.",
    ),
);

// 미매칭 요청 → 신규 고객 생성(채번+insert 트랜잭션).
quoteRequests.post("/:id/create-customer", zValidator("param", idParam), (c) =>
  run(c, async () => {
    // 트랜잭션 resolve(=커밋) 후 스케줄 — 훅의 fresh read가 커밋 전 구값을 보는 것을 방지(견적 훅과 동일).
    // 승격 INSERT는 프로필 청크 구성 필드(needModel/needTrim/needMethod/source)를 시드한다 — 고객 PATCH
    // 훅(CUSTOMER_PROFILE_EMBED_KEYS)과 동일 불변. 기존-고객 반환 경로는 hash skip이 no-op으로 흡수.
    const row = await c.var.db.transaction((tx) => createCustomerFromRequest(c.req.valid("param").id, tx));
    if (row) await schedulePromotionEmbeds(c, { appUserId: row.appUserId, customerId: row.id });
    return row;
  }, "요청을 찾을 수 없습니다."),
);
