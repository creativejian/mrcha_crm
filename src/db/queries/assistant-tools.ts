import { and, eq, ilike, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { ASSISTANT_TOOL_LABELS, type AssistantToolKey, type AssistantToolResult } from "../../lib/assistant-tools";
import type { CustomerScope } from "../../lib/assistant-scope";
import { STALE_THRESHOLDS, staffActivityAt } from "./activity";
import { getDefaultDb, type Executor } from "../client";
import { customers, customerSchedules, customerTasks, quotes } from "../schema";

// 업무 AI 도구 실행기 — 전부 read-only 화이트리스트 쿼리(자유 SQL 금지, 스펙 확정 방향 2).
// scope(역할 scope, 이사님 요구 07-06): admin/manager=전체, staff=본인 담당(customers.advisor_id) —
// 모든 도구 쿼리가 customers 기반이라 advisor 조건 하나로 균일하게 걸린다("내가"의 실제 의미).
// quote_ready·delivery_risk 정의는 07-06 잠정(이사님 사후 컨펌 대상) — 변경 = 이 파일 쿼리 교체만.

// scope → customers 조건. "all"=무조건(undefined), {advisorId}=본인 담당만.
function scopeCond(scope: CustomerScope): SQL | undefined {
  return scope === "all" ? undefined : eq(customers.advisorId, scope.advisorId);
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function kstTodayDate(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function daysSince(at: Date | string | null): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

// 관리 상태 버킷 — 임계는 activity.ts STALE_THRESHOLDS(클라 파리티 잠금), 활동 시각은 staffActivityAt
// (목록과 같은 파생 SSOT — 0706 배치 B에서 documents↔quotes 집합 드리프트 해소).
function staleBucket(days: number): string | null {
  if (days >= STALE_THRESHOLDS.abandoned) return "장기방치";
  if (days >= STALE_THRESHOLDS.delayed) return "지연";
  if (days >= STALE_THRESHOLDS.review) return "확인필요";
  return null;
}

// search_customers 파라미터(라우터가 모델 args를 그대로 넘김 — zod로 좁힌다. 미지 키는 무시).
const searchCustomersParams = z.object({
  name: z.string().optional(),
  statusGroup: z.string().optional(),
  purchaseMethod: z.string().optional(),
  source: z.string().optional(),
});

// params: 자유 질문 라우팅(PR2)의 모델 인자 — 버튼 결정론 경로(PR1)는 빈 객체를 넘긴다.
export async function runAssistantTool(key: AssistantToolKey, params: Record<string, unknown>, scope: CustomerScope, ex: Executor = getDefaultDb()): Promise<AssistantToolResult> {
  const label = ASSISTANT_TOOL_LABELS[key];
  switch (key) {
    // 미완료 할일(기한 급함/오늘) + 오늘 일정(KST) — "오늘 내가 먼저 처리할 일".
    case "today_actions": {
      const tasks = await ex
        .select({ name: customers.name, body: customerTasks.body, due: customerTasks.due })
        .from(customerTasks)
        .innerJoin(customers, eq(customers.id, customerTasks.customerId))
        .where(and(eq(customerTasks.done, false), inArray(customerTasks.due, ["급함", "오늘"]), scopeCond(scope)));
      const schedules = await ex
        .select({ name: customers.name, time: customerSchedules.scheduledTime, type: customerSchedules.type, memo: customerSchedules.memo })
        .from(customerSchedules)
        .innerJoin(customers, eq(customers.id, customerSchedules.customerId))
        .where(and(eq(customerSchedules.done, false), eq(customerSchedules.scheduledDate, kstTodayDate()), scopeCond(scope)));
      const lines = [
        ...tasks.map((t) => `${t.name} — 할일: ${t.body ?? "(내용 없음)"} (기한 ${t.due})`),
        ...schedules.map((s) => `${s.name} — 일정: ${[s.time, s.type, s.memo].filter(Boolean).join(" · ")}`),
      ];
      return { label, lines };
    }

    // customers.chance 순위(확정>높음>중간>보류>낮음) + 진행 상태 병기 — 상위 20.
    // chance는 자동 분기가 아니라 상담사가 진행 중 독립 판단으로 입력하는 수동 값(이사님 확인 07-06).
    case "chance_ranking": {
      const rows = await ex
        .select({ name: customers.name, chance: customers.chance, statusGroup: customers.statusGroup, status: customers.status })
        .from(customers)
        .where(and(isNotNull(customers.chance), scopeCond(scope)))
        .orderBy(sql`case ${customers.chance} when '확정' then 0 when '높음' then 1 when '중간' then 2 when '보류' then 3 else 4 end`)
        .limit(20);
      return { label, lines: rows.map((r, i) => `${i + 1}위 ${r.name} — 계약 가능성 ${r.chance} · 진행 ${[r.statusGroup, r.status].filter(Boolean).join("·") || "미입력"}`) };
    }

    // 최근 활동 7일+ 무활동 고객(버킷 병기) — 액션 전(신규·상담접수)은 제외(클라 관리 상태 규칙 미러).
    case "stale_customers": {
      const rows = await ex
        .select({ name: customers.name, statusGroup: customers.statusGroup, status: customers.status, at: staffActivityAt })
        .from(customers)
        .where(scopeCond(scope));
      const lines = rows
        .filter((r) => !(r.statusGroup === "신규" && r.status === "상담접수"))
        .map((r) => ({ ...r, days: daysSince(r.at) }))
        .filter((r): r is typeof r & { days: number } => r.days != null && staleBucket(r.days) != null)
        .sort((a, b) => b.days - a.days)
        .map((r) => `${r.name} — ${r.days}일 무활동 (${staleBucket(r.days)}) · 진행 ${[r.statusGroup, r.status].filter(Boolean).join("·") || "미입력"}`);
      return { label, lines };
    }

    // 진행 상태 "견적" 단계 고객 ∪ 작성 중(draft) 견적 보유 고객 — 사유 병기(이사님 컨펌 07-06: 의도대로).
    case "quote_ready": {
      const stage = await ex
        .select({ name: customers.name, status: customers.status })
        .from(customers)
        .where(and(eq(customers.statusGroup, "견적"), scopeCond(scope)));
      const drafts = await ex
        .select({ name: customers.name, quoteCode: quotes.quoteCode, vehicle: quotes.modelName })
        .from(quotes)
        .innerJoin(customers, eq(customers.id, quotes.customerId))
        .where(and(eq(quotes.appStatus, "draft"), scopeCond(scope)));
      const lines = [
        ...stage.map((r) => `${r.name} — 진행 상태 견적 단계(${r.status ?? "세부 미입력"})`),
        ...drafts.map((r) => `${r.name} — 작성 중 견적 ${r.quoteCode}${r.vehicle ? ` (${r.vehicle})` : ""} 미발송`),
      ];
      return { label, lines };
    }

    // 계약완료 단계 ∩ 7일+ 무활동 = "출고 준비·정산 준비 중 활동 공백"(이사님 컨펌 07-06: 계약완료
    // 단계는 '출고 준비 및 정산 준비' 개념 — 출고/정산 화면이 CRM에 구현되면 그 데이터 기반으로 쿼리 교체).
    case "delivery_risk": {
      const rows = await ex
        .select({ name: customers.name, status: customers.status, at: staffActivityAt })
        .from(customers)
        .where(and(eq(customers.statusGroup, "계약완료"), scopeCond(scope)));
      const lines = rows
        .map((r) => ({ ...r, days: daysSince(r.at) }))
        .filter((r): r is typeof r & { days: number } => r.days != null && r.days >= STALE_THRESHOLDS.review)
        .sort((a, b) => b.days - a.days)
        .map((r) => `${r.name} — 계약완료 단계(${r.status ?? "세부 미입력"}) · ${r.days}일 무활동`);
      return { label, lines };
    }

    // 조건 검색(PR2 자유 질문 라우팅 전용): 이름/진행 상태/구매방식/상담경로 필터 조합 — 부분 일치는
    // ilike(모델이 "앱"처럼 축약을 넘겨도 "앱 견적요청"·"앱 상담원 연결"이 걸리게). 상한 30.
    case "search_customers": {
      const parsed = searchCustomersParams.safeParse(params);
      const f = parsed.success ? parsed.data : {};
      const conds: SQL[] = [];
      const sCond = scopeCond(scope);
      if (sCond) conds.push(sCond);
      if (f.name) conds.push(ilike(customers.name, `%${f.name}%`));
      if (f.statusGroup) conds.push(eq(customers.statusGroup, f.statusGroup));
      if (f.purchaseMethod) conds.push(ilike(customers.needMethod, `%${f.purchaseMethod}%`));
      if (f.source) conds.push(ilike(customers.source, `%${f.source}%`));
      const rows = await ex
        .select({ name: customers.name, source: customers.source, statusGroup: customers.statusGroup, status: customers.status, needMethod: customers.needMethod })
        .from(customers)
        .where(conds.length ? and(...conds) : undefined)
        .limit(30);
      const filterLabel = [
        f.name && `이름 ${f.name}`, f.statusGroup && `진행 ${f.statusGroup}`,
        f.purchaseMethod && `구매방식 ${f.purchaseMethod}`, f.source && `상담경로 ${f.source}`,
      ].filter(Boolean).join(" · ") || "전체";
      const lines = rows.map((r) =>
        `${r.name} — 상담경로 ${r.source ?? "미입력"} · 진행 ${[r.statusGroup, r.status].filter(Boolean).join("·") || "미입력"}${r.needMethod ? ` · 구매방식 ${r.needMethod}` : ""}`);
      return { label: `${label}(${filterLabel})`, lines };
    }
  }
}
