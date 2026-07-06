import { sql } from "drizzle-orm";

import { customers } from "../schema";

// "마지막 담당자 액션" 파생 SSOT — 목록/상세(listCustomers 계열)와 업무 AI 도구(stale_customers/
// delivery_risk)가 공유한다. #171이 이 식을 재선언하며 4번째 자식이 갈렸던(documents↔quotes) 실드리프트
// 해소(0706 배치 B): 서류만 최근인 고객이 목록 배지 '정상'인데 AI '응답 지연' 리포트에 무활동으로 뜨는
// 화면 내 모순. 집합 = customers.updated_at + 자식 5테이블 max(created_at) 합집합(memos/tasks/schedules/
// documents/quotes — 견적 작성·서류 업로드 모두 담당자 액션). 자식 테이블엔 updated_at이 없어 수정은
// 못 잡는다(허용 근사 — #154와 동일).
// 주의: 상관 서브쿼리 안에서는 반드시 `crm.customers.id`로 완전정규화한다 — 자식 테이블 모두 자기 자신의
// "id" 컬럼을 갖고 있어, `${customers.id}`(비정규화 "id")를 쓰면 SQL 스코프 규칙상 서브쿼리 자신의 테이블로
// 섀도잉되어 조건이 사실상 항상 거짓이 된다(greatest가 전부 NULL을 받아 customers.updated_at만 남는
// 조용한 오답 — #154에서 실측으로 발견).
export const staffActivityAt = sql<Date | null>`greatest(
  ${customers.updatedAt},
  (select max(m.created_at) from crm.customer_memos m where m.customer_id = crm.customers.id),
  (select max(t.created_at) from crm.customer_tasks t where t.customer_id = crm.customers.id),
  (select max(s.created_at) from crm.customer_schedules s where s.customer_id = crm.customers.id),
  (select max(d.created_at) from crm.customer_documents d where d.customer_id = crm.customers.id),
  (select max(q.created_at) from crm.quotes q where q.customer_id = crm.customers.id)
)`;

// 관리 상태 버킷 임계(달력일) — 클라 customer-table.finalUpdateStatus(7/15/30)와 같은 어휘.
// 드리프트는 클라 파리티 테스트(manage-status-parity.test.ts, 서버 모듈 테스트 전용 import)가 잡는다.
export const STALE_THRESHOLDS = { review: 7, delayed: 15, abandoned: 30 } as const;
