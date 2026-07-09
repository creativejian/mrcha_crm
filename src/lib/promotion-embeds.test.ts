import { expect, test } from "bun:test";

import { getDefaultDb } from "../db/client";
import { quoteRequests } from "../db/public-app";
import { listQuoteRequestIdsByUser } from "../db/queries/quote-requests";
import { promotionEmbedJobs } from "./promotion-embeds";

const db = getDefaultDb();

// 승격 훅 SSOT — 견적요청·상담신청 라우트 4곳(link×2 · create-customer×2)이 공유한다.
// quote_request 청크는 app_user_id 연결이 있어야 적재되므로(embed-sources.loadCorpusSource),
// 연결을 만드는 **모든** 경로가 그 유저의 요청을 스케줄해야 한다. 상담 승격 라우트가 이걸
// 빠뜨려 상담 경로로 승격된 유저의 앱 견적요청이 백필 전까지 코퍼스에 없었다(0709 감사).
test("promotionEmbedJobs: 앱 유저의 견적요청 전부를 quote_request job으로 낸다", async () => {
  const [req] = await db.select({ userId: quoteRequests.userId }).from(quoteRequests).limit(1);
  expect(req).toBeDefined(); // 실 master 전제

  const ids = await listQuoteRequestIdsByUser(req.userId, db);
  expect(ids.length).toBeGreaterThan(0);

  const jobs = await promotionEmbedJobs({ appUserId: req.userId }, db);
  expect(jobs).toEqual(ids.map((id) => ({ sourceType: "quote_request", sourceId: id })));
});

// create-customer는 승격 INSERT가 프로필 청크 구성 필드(needModel/source)를 시드하므로 프로필도 함께.
// link는 app_user_id·phone만 바꾸는데 그건 customer_profile 청크 구성 필드가 아니라 제외(기존 의도).
test("promotionEmbedJobs: customerId를 주면 customer_profile job이 뒤에 붙는다", async () => {
  const [req] = await db.select({ userId: quoteRequests.userId }).from(quoteRequests).limit(1);
  const ids = await listQuoteRequestIdsByUser(req.userId, db);
  const customerId = crypto.randomUUID();

  const jobs = await promotionEmbedJobs({ appUserId: req.userId, customerId }, db);
  expect(jobs).toHaveLength(ids.length + 1);
  expect(jobs.at(-1)).toEqual({ sourceType: "customer_profile", sourceId: customerId });
});

test("promotionEmbedJobs: 요청이 없는 앱 유저는 프로필 job만(또는 빈 배열)", async () => {
  const orphanUser = crypto.randomUUID(); // 요청 0건
  expect(await promotionEmbedJobs({ appUserId: orphanUser }, db)).toEqual([]);

  const customerId = crypto.randomUUID();
  expect(await promotionEmbedJobs({ appUserId: orphanUser, customerId }, db)).toEqual([
    { sourceType: "customer_profile", sourceId: customerId },
  ]);
});
