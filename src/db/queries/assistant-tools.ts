import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { ASSISTANT_TOOL_LABELS, type AssistantToolKey, type AssistantToolResult } from "../../lib/assistant-tools";
import { getDefaultDb, type Executor } from "../client";
import { customers, customerSchedules, customerTasks, quotes } from "../schema";

// 업무 AI 도구 실행기 — 전부 read-only 화이트리스트 쿼리(자유 SQL 금지, 스펙 확정 방향 2).
// scope는 v1 admin=전체(resolveCustomerScope seam이 "all"만 반환 — 역할 scope 슬라이스에서 이 파일도 필터 추가).
// quote_ready·delivery_risk 정의는 07-06 잠정(이사님 사후 컨펌 대상) — 변경 = 이 파일 쿼리 교체만.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function kstTodayDate(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// staffActivityAt(#154)와 동일 취지의 최근 활동 시각 — customers.updated_at과 자식 4테이블 max(created_at)의
// GREATEST. 목록 쿼리(listCustomers)의 파생을 재사용하지 않고 재선언하는 이유: 목록은 표시 필드 전체를
// 끌고 와 무겁고, 도구는 (id, name, status, 활동시각)만 필요하다. 외부참조는 완전정규화(#154 섀도잉 버그).
const lastActivityAt = sql<Date | null>`greatest(
  ${customers.updatedAt},
  (select max(m.created_at) from crm.customer_memos m where m.customer_id = ${sql.raw("crm.customers.id")}),
  (select max(t.created_at) from crm.customer_tasks t where t.customer_id = ${sql.raw("crm.customers.id")}),
  (select max(s.created_at) from crm.customer_schedules s where s.customer_id = ${sql.raw("crm.customers.id")}),
  (select max(q.created_at) from crm.quotes q where q.customer_id = ${sql.raw("crm.customers.id")})
)`;

function daysSince(at: Date | string | null): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

// 관리 상태 버킷(클라 manage-status.ts와 동일 임계 — 7/15/30 달력일 근사).
function staleBucket(days: number): string | null {
  if (days >= 30) return "장기방치";
  if (days >= 15) return "지연";
  if (days >= 7) return "확인필요";
  return null;
}

export async function runAssistantTool(key: AssistantToolKey, ex: Executor = getDefaultDb()): Promise<AssistantToolResult> {
  const label = ASSISTANT_TOOL_LABELS[key];
  switch (key) {
    // 미완료 할일(기한 급함/오늘) + 오늘 일정(KST) — "오늘 내가 먼저 처리할 일".
    case "today_actions": {
      const tasks = await ex
        .select({ name: customers.name, body: customerTasks.body, due: customerTasks.due })
        .from(customerTasks)
        .innerJoin(customers, eq(customers.id, customerTasks.customerId))
        .where(and(eq(customerTasks.done, false), inArray(customerTasks.due, ["급함", "오늘"])));
      const schedules = await ex
        .select({ name: customers.name, time: customerSchedules.scheduledTime, type: customerSchedules.type, memo: customerSchedules.memo })
        .from(customerSchedules)
        .innerJoin(customers, eq(customers.id, customerSchedules.customerId))
        .where(and(eq(customerSchedules.done, false), eq(customerSchedules.scheduledDate, kstTodayDate())));
      const lines = [
        ...tasks.map((t) => `${t.name} — 할일: ${t.body ?? "(내용 없음)"} (기한 ${t.due})`),
        ...schedules.map((s) => `${s.name} — 일정: ${[s.time, s.type, s.memo].filter(Boolean).join(" · ")}`),
      ];
      return { label, lines };
    }

    // customers.chance 순위(확정>높음>중간>보류>낮음) + 진행 상태 병기 — 상위 20.
    case "chance_ranking": {
      const rows = await ex
        .select({ name: customers.name, chance: customers.chance, statusGroup: customers.statusGroup, status: customers.status })
        .from(customers)
        .where(isNotNull(customers.chance))
        .orderBy(sql`case ${customers.chance} when '확정' then 0 when '높음' then 1 when '중간' then 2 when '보류' then 3 else 4 end`)
        .limit(20);
      return { label, lines: rows.map((r, i) => `${i + 1}위 ${r.name} — 계약 가능성 ${r.chance} · 진행 ${[r.statusGroup, r.status].filter(Boolean).join("·") || "미입력"}`) };
    }

    // 최근 활동 7일+ 무활동 고객(버킷 병기) — 액션 전(신규·상담접수)은 제외(클라 관리 상태 규칙 미러).
    case "stale_customers": {
      const rows = await ex
        .select({ name: customers.name, statusGroup: customers.statusGroup, status: customers.status, at: lastActivityAt })
        .from(customers);
      const lines = rows
        .filter((r) => !(r.statusGroup === "신규" && r.status === "상담접수"))
        .map((r) => ({ ...r, days: daysSince(r.at) }))
        .filter((r): r is typeof r & { days: number } => r.days != null && staleBucket(r.days) != null)
        .sort((a, b) => b.days - a.days)
        .map((r) => `${r.name} — ${r.days}일 무활동 (${staleBucket(r.days)}) · 진행 ${[r.statusGroup, r.status].filter(Boolean).join("·") || "미입력"}`);
      return { label, lines };
    }

    // [잠정] 진행 상태 "견적" 단계 고객 ∪ 작성 중(draft) 견적 보유 고객 — 사유 병기.
    case "quote_ready": {
      const stage = await ex
        .select({ name: customers.name, status: customers.status })
        .from(customers)
        .where(eq(customers.statusGroup, "견적"));
      const drafts = await ex
        .select({ name: customers.name, quoteCode: quotes.quoteCode, vehicle: quotes.modelName })
        .from(quotes)
        .innerJoin(customers, eq(customers.id, quotes.customerId))
        .where(eq(quotes.appStatus, "draft"));
      const lines = [
        ...stage.map((r) => `${r.name} — 진행 상태 견적 단계(${r.status ?? "세부 미입력"})`),
        ...drafts.map((r) => `${r.name} — 작성 중 견적 ${r.quoteCode}${r.vehicle ? ` (${r.vehicle})` : ""} 미발송`),
      ];
      return { label, lines };
    }

    // [잠정] 계약완료 단계 ∩ 7일+ 무활동 = "출고 진행 중 활동 공백" 근사 — CRM에 출고/정산 데이터가
    // 아직 없어 진행 상태 기반 근사(이사님 정의 확정 시 교체).
    case "delivery_risk": {
      const rows = await ex
        .select({ name: customers.name, status: customers.status, at: lastActivityAt })
        .from(customers)
        .where(eq(customers.statusGroup, "계약완료"));
      const lines = rows
        .map((r) => ({ ...r, days: daysSince(r.at) }))
        .filter((r): r is typeof r & { days: number } => r.days != null && r.days >= 7)
        .sort((a, b) => b.days - a.days)
        .map((r) => `${r.name} — 계약완료 단계(${r.status ?? "세부 미입력"}) · ${r.days}일 무활동`);
      return { label, lines };
    }
  }
}
