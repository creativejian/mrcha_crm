import { and, desc, eq, ilike, inArray, isNotNull, notExists, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { ASSISTANT_TOOL_LABELS, CRM_ROLE_LABELS, type AssistantToolKey, type AssistantToolResult } from "../../lib/assistant-tools";
import type { AuthedUser } from "../../auth/verify";
import type { CustomerScope } from "../../lib/assistant-scope";
import { kstDateOf, kstDayDiff } from "../../lib/kst-date";
import { manualManageStatusActive, STALE_THRESHOLDS, staffActivityAt } from "./activity";
import { getDefaultDb, type Executor } from "../client";
import { composedPhone } from "./customers"; // 주 번호 합성 SSOT — 손 복제 금지(앱 연결 고객은 customers.phone이 항상 NULL)
import { consultationRequests, profiles } from "../public-app";
import { consultationDismissals, customers, customerSchedules, customerTasks, quotes } from "../schema";
import { isPreActionStatus } from "../../../client/src/data/customers"; // 순수 leaf(부작용 0) — 액션 전 상태 게이트 클라 공유

// 업무 AI 도구 실행기 — 전부 read-only 화이트리스트 쿼리(자유 SQL 금지, 스펙 확정 방향 2).
// scope(역할 scope, 이사님 요구 07-06): admin/manager=전체, staff=본인 담당(customers.advisor_id) —
// 모든 도구 쿼리가 customers 기반이라 advisor 조건 하나로 균일하게 걸린다("내가"의 실제 의미).
// quote_ready·delivery_risk 정의는 07-06 잠정(이사님 사후 컨펌 대상) — 변경 = 이 파일 쿼리 교체만.

// scope → customers 조건. "all"=무조건(undefined), {advisorId}=본인 담당만.
function scopeCond(scope: CustomerScope): SQL | undefined {
  return scope === "all" ? undefined : eq(customers.advisorId, scope.advisorId);
}

// 무활동 일수 = KST 달력일 차(kstDayDiff). 클라 목록 배지(manage-status.deriveFinalUpdateInfo)와 같은
// 지표여야 임계(STALE_THRESHOLDS)가 같은 뜻을 갖는다 — 계산법 드리프트는 manage-status-parity가 잡는다.
export function daysSince(at: Date | string | null, now: Date = new Date()): number | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, kstDayDiff(d, now));
}

// 관리 상태 버킷 — 임계는 activity.ts STALE_THRESHOLDS(클라 파리티 잠금), 활동 시각은 staffActivityAt
// (목록과 같은 파생 SSOT — 0706 배치 B에서 documents↔quotes 집합 드리프트 해소).
function staleBucket(days: number): string | null {
  if (days >= STALE_THRESHOLDS.abandoned) return "장기방치";
  if (days >= STALE_THRESHOLDS.delayed) return "지연";
  if (days >= STALE_THRESHOLDS.review) return "확인필요";
  return null;
}

// 리포트 행 상한 — 도구 결과는 근거 1청크로 Gemini 프롬프트에 통째 실리므로(assistant.ts) 무상한이면
// 행 수에 비례해 토큰이 무한 성장한다(chance 20·search 30 상한과 대칭). 잘림은 '외 N{unit}' 행으로 총량을
// 모델에 알린다. **호출부는 반드시 중요도 desc로 정렬해 넘긴다** — slice가 뒤를 버리므로 앞이 보존된다
// (고객 리포트=무활동 days desc, 견적·상담=최신 createdAt desc). unit은 행의 단위: 행이 사람이면 "명",
// 한 고객의 견적/상담이면 "건"(0709 감사 — 상담 44건을 "외 14명"으로 오표기하던 것).
const REPORT_ROW_LIMIT = 30;
export function capReportLines(lines: string[], unit: "명" | "건"): string[] {
  if (lines.length <= REPORT_ROW_LIMIT) return lines;
  return [...lines.slice(0, REPORT_ROW_LIMIT), `외 ${lines.length - REPORT_ROW_LIMIT}${unit} — 상위 ${REPORT_ROW_LIMIT}${unit}만 표시`];
}

// search_customers 파라미터(라우터가 모델 args를 그대로 넘김 — zod로 좁힌다. 미지 키는 무시).
// mine = 질문 의도("내 담당") 필터 — 권한 경계(scope)와 별개: staff는 scope가 이미 본인 담당으로 강제하고,
// admin/manager(scope="all")에서 1인칭 질문의 실제 의미를 만든다.
const searchCustomersParams = z.object({
  name: z.string().optional(),
  statusGroup: z.string().optional(),
  purchaseMethod: z.string().optional(),
  source: z.string().optional(),
  mine: z.boolean().optional(),
});

// 고객 1명의 하위 레코드를 조회하는 도구(customer_quotes·customer_consultations)의 공통 파라미터·조립.
// 세 번째 유사 도구가 붙을 때 또 복제되지 않도록 뼈대만 공유한다 — 쿼리 본문(조인·select·라인 매핑)은
// 도구마다 이질적이라 각자 유지한다.
const nameFilterParams = z.object({ name: z.string().optional() });

function nameFilter(params: Record<string, unknown>): { name?: string } {
  const parsed = nameFilterParams.safeParse(params);
  return parsed.success ? parsed.data : {};
}

// scope(권한) + 이름 부분일치를 합친 조건. extra는 도구 고유 조건(예: dismissed 제외).
function nameFilterConds(scope: CustomerScope, f: { name?: string }, extra: SQL[] = []): SQL[] {
  const conds = [...extra];
  const sCond = scopeCond(scope);
  if (sCond) conds.push(sCond);
  if (f.name) conds.push(ilike(customers.name, `%${f.name}%`));
  return conds;
}

const nameFilterLabel = (f: { name?: string }): string => (f.name ? `이름 ${f.name}` : "전체");

// params: 자유 질문 라우팅(PR2)의 모델 인자 — 버튼 결정론 경로(PR1)는 빈 객체를 넘긴다.
// user: 현재 로그인 사용자(JWT) — current_user 리포트·mine 필터의 "나" 해석 기준(scope와 별개 식별자).
export async function runAssistantTool(key: AssistantToolKey, params: Record<string, unknown>, scope: CustomerScope, user: AuthedUser, ex: Executor = getDefaultDb()): Promise<AssistantToolResult> {
  const label = ASSISTANT_TOOL_LABELS[key];
  switch (key) {
    // 미완료 할일(기한 급함/오늘) + 오늘 일정(KST) — "오늘 내가 먼저 처리할 일".
    case "today_actions": {
      // 서로 독립인 두 SELECT — 병렬로 원격 DB 왕복 1회분 지연 제거(/ask 히스토리∥검색 병렬과 동일 사유).
      const [tasks, schedules] = await Promise.all([
        ex
          .select({ name: customers.name, body: customerTasks.body, due: customerTasks.due })
          .from(customerTasks)
          .innerJoin(customers, eq(customers.id, customerTasks.customerId))
          .where(and(eq(customerTasks.done, false), inArray(customerTasks.due, ["급함", "오늘"]), scopeCond(scope))),
        ex
          .select({ name: customers.name, time: customerSchedules.scheduledTime, type: customerSchedules.type, memo: customerSchedules.memo })
          .from(customerSchedules)
          .innerJoin(customers, eq(customers.id, customerSchedules.customerId))
          .where(and(eq(customerSchedules.done, false), eq(customerSchedules.scheduledDate, kstDateOf(new Date())), scopeCond(scope))),
      ]);
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

    // 최근 활동 7일+ 무활동 고객(버킷 병기) — 액션 전(신규·상담접수)은 **파생 경로만** 제외(클라 관리
    // 상태 규칙 미러). 유효 수동은 신규·상담접수라도 포함 — 수동 지정 자체가 상담사 액션이고, 목록
    // 배지·필터·상세 드로어가 수동을 표시하므로 리포트만 빼면 배지↔리포트 모순(배치 4 B2 기각 번복
    // 2026-07-14, 유슨생 승인 — 구 기각 근거 "클라 배지도 공백"은 배지 셀만 본 불완전 전제였다).
    // 재문의(recontacted) 고객은 버킷 라벨 대신 "재문의" 표기 — 목록 배지(finalUpdateStatus의
    // recontacted 우선)와 통일(이사님 2026-07-13 ①). 무활동 일수·노출 자체는 유지(오표기만 교정).
    // 유효한 수동 관리 상태(스누즈, ⑦-①)는 라벨 최우선 + **멤버십도 일수 게이트 무관 포함**(항목 8 ① —
    // 수동 지정 PATCH가 updated_at을 bump해 0일에서 시작하므로, 버킷만 보면 설정 직후 ~7일간 배지는
    // "지연"인데 리포트에 없는 모순. 유슨생 선승인 2026-07-13·이사님 사후 확인). 수동 "정상"은
    // 목록 배지가 정상이므로 리포트에서 제외(배지-리포트 모순 방지).
    case "stale_customers": {
      const rows = await ex
        .select({ name: customers.name, statusGroup: customers.statusGroup, status: customers.status, recontacted: customers.recontacted, manageStatus: customers.manageStatus, manageStatusAt: customers.manageStatusAt, at: staffActivityAt })
        .from(customers)
        .where(scopeCond(scope));
      const lines = rows
        .map((r) => ({ ...r, days: daysSince(r.at), manual: manualManageStatusActive(r.manageStatusAt, r.at) ? r.manageStatus : null }))
        .filter((r) => r.manual != null || !isPreActionStatus(r.statusGroup, r.status))
        .filter((r): r is typeof r & { days: number } => r.days != null && (staleBucket(r.days) != null || r.manual != null))
        .filter((r) => r.manual !== "정상")
        .sort((a, b) => b.days - a.days)
        .map((r) => {
          const badge = r.manual
            ? r.manual === "재문의" ? "재문의(고객이 먼저 다시 연락)" : `${r.manual}(수동 지정)`
            : r.recontacted ? "재문의(고객이 먼저 다시 연락)" : staleBucket(r.days);
          return `${r.name} — ${r.days}일 무활동 (${badge}) · 진행 ${[r.statusGroup, r.status].filter(Boolean).join("·") || "미입력"}`;
        });
      return { label, lines: capReportLines(lines, "명") };
    }

    // 진행 상태 "견적" 단계 고객 ∪ 작성 중(draft) 견적 보유 고객 — 사유 병기(이사님 컨펌 07-06: 의도대로).
    case "quote_ready": {
      // 서로 독립인 두 SELECT — today_actions와 동일 사유로 병렬.
      const [stage, drafts] = await Promise.all([
        ex
          .select({ name: customers.name, status: customers.status })
          .from(customers)
          .where(and(eq(customers.statusGroup, "견적"), scopeCond(scope))),
        ex
          .select({ name: customers.name, quoteCode: quotes.quoteCode, vehicle: quotes.modelName })
          .from(quotes)
          .innerJoin(customers, eq(customers.id, quotes.customerId))
          .where(and(eq(quotes.appStatus, "draft"), scopeCond(scope))),
      ]);
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
        .select({ name: customers.name, status: customers.status, recontacted: customers.recontacted, manageStatus: customers.manageStatus, manageStatusAt: customers.manageStatusAt, at: staffActivityAt })
        .from(customers)
        .where(and(eq(customers.statusGroup, "계약완료"), scopeCond(scope)));
      const lines = rows
        .map((r) => ({ ...r, days: daysSince(r.at), manual: manualManageStatusActive(r.manageStatusAt, r.at) ? r.manageStatus : null }))
        // 유효 수동 비'정상'은 임계 미달이어도 포함(항목 8 ① — stale_customers와 동일 사유).
        .filter((r): r is typeof r & { days: number } => r.days != null && (r.days >= STALE_THRESHOLDS.review || r.manual != null))
        // 유효 수동 "정상"은 목록 배지도 정상 — 리스크 리포트에서 제외(stale_customers와 동일 사유).
        .filter((r) => r.manual !== "정상")
        .sort((a, b) => b.days - a.days)
        // 재문의·수동 상태 병기 — stale_customers와 동일 사유(목록 배지와 라벨 통일, 이사님 2026-07-13 ①·⑦-①).
        .map((r) => {
          const tag = r.manual
            ? r.manual === "재문의" ? " · 재문의(고객이 먼저 다시 연락)" : ` · ${r.manual}(수동 지정)`
            : r.recontacted ? " · 재문의(고객이 먼저 다시 연락)" : "";
          return `${r.name} — 계약완료 단계(${r.status ?? "세부 미입력"}) · ${r.days}일 무활동${tag}`;
        });
      return { label, lines: capReportLines(lines, "명") };
    }

    // 조건 검색(PR2 자유 질문 라우팅 전용): 이름/진행 상태/구매방식/상담경로 필터 조합 — 부분 일치는
    // ilike(모델이 "앱"처럼 축약을 넘겨도 "앱 견적요청"·"앱 상담원 연결"이 걸리게). 상한 30.
    case "search_customers": {
      const parsed = searchCustomersParams.safeParse(params);
      const f = parsed.success ? parsed.data : {};
      const conds: SQL[] = [];
      const sCond = scopeCond(scope);
      if (sCond) conds.push(sCond);
      if (f.mine) conds.push(eq(customers.advisorId, user.id)); // 질문 의도 필터 — scope(권한)와 별개
      if (f.name) conds.push(ilike(customers.name, `%${f.name}%`));
      if (f.statusGroup) conds.push(eq(customers.statusGroup, f.statusGroup));
      if (f.purchaseMethod) conds.push(ilike(customers.needMethod, `%${f.purchaseMethod}%`));
      if (f.source) conds.push(ilike(customers.source, `%${f.source}%`));
      // 연락처 2종을 함께 싣는다(2026-07-23). 주 번호는 **반드시 합성**(composedPhone + profiles 조인) —
      // 앱 연결 고객은 `customers.phone`이 CHECK로 항상 NULL이라 컬럼만 읽으면 화면엔 번호가 보이는데
      // AI만 "연락처 없음"이라 답한다(실제 발생: 제임스 CU-2606-0002). 조인은 app_user_id→profiles.id
      // many-to-one이라 행이 늘지 않는다.
      const rows = await ex
        .select({
          name: customers.name,
          phone: composedPhone,
          phoneSecondary: customers.phoneSecondary,
          source: customers.source,
          statusGroup: customers.statusGroup,
          status: customers.status,
          needMethod: customers.needMethod,
        })
        .from(customers)
        .leftJoin(profiles, eq(customers.appUserId, profiles.id))
        .where(conds.length ? and(...conds) : undefined)
        .limit(30);
      const filterLabel = [
        f.mine && "내 담당", f.name && `이름 ${f.name}`, f.statusGroup && `진행 ${f.statusGroup}`,
        f.purchaseMethod && `구매방식 ${f.purchaseMethod}`, f.source && `상담경로 ${f.source}`,
      ].filter(Boolean).join(" · ") || "전체";
      const lines = rows.map((r) =>
        // 주 번호와 추가 연락처를 **라벨로 구분**한다 — phone_secondary는 회사·배우자 번호일 수 있어
        // "본인 번호"로 뭉뚱그리면 안 된다(소유권 계약 #276: 추가 연락처는 매칭 금지 축).
        // 없으면 "미입력"을 명시 — 침묵하면 모델이 "결과에 없다"와 "고객에게 없다"를 구분하지 못한다.
        `${r.name} — 연락처 ${r.phone ?? "미입력"}${r.phoneSecondary ? ` · 추가 연락처 ${r.phoneSecondary}` : ""}` +
        ` · 상담경로 ${r.source ?? "미입력"} · 진행 ${[r.statusGroup, r.status].filter(Boolean).join("·") || "미입력"}${r.needMethod ? ` · 구매방식 ${r.needMethod}` : ""}`);
      return { label: `${label}(${filterLabel})`, lines };
    }

    // 현재 로그인 사용자 리포트("난 누구야?") — 본인 정보라 scope 무관(고객 데이터는 담당 수 집계뿐).
    case "current_user": {
      const [[profile], [assigned]] = await Promise.all([
        ex.select({ name: profiles.fullName, role: profiles.role }).from(profiles).where(eq(profiles.id, user.id)),
        ex.select({ n: sql<number>`count(*)::int` }).from(customers).where(eq(customers.advisorId, user.id)),
      ]);
      const role = profile?.role ?? user.role;
      const line = `${profile?.name?.trim() || "이름 미상"} — 역할 ${CRM_ROLE_LABELS[role] ?? role}(${role}) · 담당 고객 ${assigned?.n ?? 0}명`;
      return { label, lines: [line] };
    }

    // 특정 고객의 견적 목록(코드·차종·발송 상태) — crm.quotes 직접 조회. 견적 개수/차종 질문에
    // search_customers(견적 미조회)로 답하던 모델 환각(존재하지 않는 코드·차종)의 근본 해법.
    // quotes에 brand_name/model_name/trim_name 라벨 컬럼이 상주해 catalog 조인 불요.
    case "customer_quotes": {
      const f = nameFilter(params);
      const conds = nameFilterConds(scope, f);
      const rows = await ex
        .select({
          name: customers.name, code: quotes.quoteCode,
          brand: quotes.brandName, model: quotes.modelName, trim: quotes.trimName,
          appStatus: quotes.appStatus, viewedAt: quotes.viewedAt, createdAt: quotes.createdAt,
        })
        .from(quotes)
        .innerJoin(customers, eq(customers.id, quotes.customerId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(quotes.createdAt)); // 최신 우선 — capReportLines가 뒤를 버린다
      const lines = rows.map((r) => {
        const car = [r.brand, r.model, r.trim].filter(Boolean).join(" ") || "차종 미정";
        const state = r.appStatus === "sent" ? (r.viewedAt ? "발송완료·고객 열람" : "발송완료") : "작성중";
        return `${r.name} · ${r.code} · ${car} · ${state}`;
      });
      return { label: `${label}(${nameFilterLabel(f)})`, lines: capReportLines(lines, "건") };
    }

    // 특정 고객의 앱 상담신청 목록(관심 차종·문의 내용·신청일) — public.consultations를 CRM 고객(app_user_id)에
    // 연결해 조회하고 CRM에서 숨긴(dismissed) 건은 제외한다. 고객명 상담 질문에 search_customers/customer_quotes로
    // 답하던 오라우팅(상담 데이터 미조회 → "상담신청 안 했다" 오답)의 해법. 미연결(승격 전) 상담은 CRM 고객이
    // 없어 조회되지 않는다(인박스 승격 후 노출).
    case "customer_consultations": {
      const f = nameFilter(params);
      // CRM에서 숨긴(dismissed) 상담신청 제외 — 이 도구 고유 조건.
      const notDismissed = notExists(
        ex.select({ id: consultationDismissals.consultationId })
          .from(consultationDismissals)
          .where(eq(consultationDismissals.consultationId, consultationRequests.id)),
      );
      const conds = nameFilterConds(scope, f, [notDismissed]);
      const rows = await ex
        .select({
          name: customers.name, carModel: consultationRequests.carModel,
          notes: consultationRequests.notes, createdAt: consultationRequests.createdAt,
        })
        .from(consultationRequests)
        .innerJoin(customers, eq(customers.appUserId, consultationRequests.userId))
        .where(and(...conds))
        .orderBy(desc(consultationRequests.createdAt)); // 최신 우선 — 실 master에 44건 고객 상존(상한 30 초과)
      const lines = rows.map((r) => {
        const car = r.carModel?.trim() || "관심 차종 미지정";
        const note = r.notes?.trim() || "문의 내용 없음";
        return `${r.name} · ${kstDateOf(new Date(r.createdAt))} · ${car} · 문의: ${note}`;
      });
      return { label: `${label}(${nameFilterLabel(f)})`, lines: capReportLines(lines, "건") };
    }
  }
}
