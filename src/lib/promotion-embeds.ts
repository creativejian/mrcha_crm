import type { Executor } from "../db/client";
import { listQuoteRequestIdsByUser } from "../db/queries/quote-requests";
import { scheduleEmbedOnWrite, type EmbedOnWriteJob } from "./embed-on-write";

// 앱 유저 승격(link · create-customer)이 만들어내는 임베딩 job 목록 — 견적요청·상담신청 라우트 공유 SSOT.
//
// quote_request 청크는 `customers.app_user_id = quote_requests.user_id` 연결이 있어야만 적재된다
// (embed-sources.loadCorpusSource: 미연결이면 null). 따라서 **연결을 만드는 모든 경로**가 그 유저의
// 요청 전부를 스케줄해야 한다(요청당 1 job, hash skip이 기적재분을 no-op으로 흡수). 승격 후에는
// 인박스가 그 요청에 승격 액션을 더는 노출하지 않으므로(matchType이 app_user로 전환) 여기서 빠뜨리면
// 백필을 수동 실행하기 전까지 코퍼스에 영구 공백이 남는다 — 상담 승격 라우트가 이걸 빠뜨렸다(0709 감사).
//
// customerId는 create-customer에서만 넘긴다: 승격 INSERT가 프로필 청크 구성 필드(needModel/source 등)를
// 시드하므로 customer_profile 재임베딩이 필요하다. link(applyAppUserLink, 2026-07-17 #276)는
// app_user_id·phone(CHECK 배타로 NULL 강제)·phone_secondary(전이 보존)를 세팅하는데 셋 다 프로필
// 청크 구성 필드가 아니라 제외한다(재임베딩 불요 결론 유지).
//
// 이후 앱이 write하는 신규 요청은 CRM 훅이 없어 백필이 보정한다(주기 보정은 CF Cron 검토 보류).
export async function promotionEmbedJobs(
  opts: { appUserId: string; customerId?: string },
  ex: Executor,
): Promise<EmbedOnWriteJob[]> {
  const requestIds = await listQuoteRequestIdsByUser(opts.appUserId, ex);
  const jobs: EmbedOnWriteJob[] = requestIds.map((id) => ({ sourceType: "quote_request", sourceId: id }));
  if (opts.customerId) jobs.push({ sourceType: "customer_profile", sourceId: opts.customerId });
  return jobs;
}

// 라우트 훅 — job 목록을 뽑아 전부 스케줄. 견적요청·상담신청 라우트가 공유한다(동일 6줄 래퍼가
// 두 라우트에 복제돼 있던 것 통합, 0713 감사). 컨텍스트 타입은 scheduleEmbedOnWrite의 구조적
// HookContext를 그대로 따른다 — hono Context가 Variables invariant라 교차 Variables 라우트 수용.
export async function schedulePromotionEmbeds(
  c: Parameters<typeof scheduleEmbedOnWrite>[0],
  opts: { appUserId: string; customerId?: string },
): Promise<void> {
  for (const job of await promotionEmbedJobs(opts, c.var.db)) scheduleEmbedOnWrite(c, job);
}
