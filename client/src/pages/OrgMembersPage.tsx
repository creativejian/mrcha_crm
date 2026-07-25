import { useState } from "react";

import { ROLE_ACCESS_SUMMARY, roleLabelOf } from "@/data/roles";
import { useOrgMembers } from "@/lib/org-members";
import { formatPhone } from "@/lib/phone-format";

// ⚠️ 「조직」·「권한」 탭은 아직 목업이다(2026-07-25 유슨생 결정 — 구성원 탭만 실데이터화).
// DB에 대응하는 것이 없다: `public.profiles`는 id·email·username·role·avatar_url·created_at·
// full_name·phone_* 10컬럼뿐이라 **팀(소속) 개념이 없고**, 조직도를 담을 테이블도 없다.
// 실데이터화하려면 스키마 신설이 선행이라 별건으로 남긴다.
const teams = [
  ["대표실", "사업 방향, 권한 승인, 재무 최종 확인", "1명"],
  ["상담팀", "앱 상담 연결, 고객 응대, 상담 메모", "3명 예정"],
  ["견적팀", "견적 생성, 조건 비교, 앱 송출", "2명 예정"],
  ["출고/정산팀", "계약 이후 출고 체크, 수수료 정산", "1명 예정"],
];

const permissions = [
  ["최고관리자", "전체 메뉴, 재무, 조직, AI 설정, 데이터 기준 관리"],
  ["중간관리자", "팀 고객, 상담 현황, 견적/계약 관리, 일부 콘텐츠 관리"],
  ["상담사", "배정 고객, 실시간 상담, 견적 확인, 본인 업무 큐"],
];

export function OrgMembersPage() {
  const [tab, setTab] = useState<"members" | "teams" | "roles">("members");
  const { members, loading, failed } = useOrgMembers();

  return (
    <div className="ops-layout">
      <section className="card">
        <div className="panel-head">
          <h2>조직 운영 기준</h2>
          <span className="badge blue">대표 전용</span>
        </div>
        <div className="panel-body">
          <div className="ops-tabs">
            <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")} type="button">구성원</button>
            <button className={tab === "teams" ? "active" : ""} onClick={() => setTab("teams")} type="button">조직</button>
            <button className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")} type="button">권한</button>
          </div>

          {tab === "members" && (
            <div className="table-scroll">
              {/* 컬럼은 **실제로 있는 값**만 낸다(2026-07-25). 구 목업의 "소속"(기술본부·상담팀)과
                  "상태"(운영중·초대 예정)는 DB에 대응 컬럼이 없어 지어낸 값이었다 — 소속은 담당 고객
                  수로, 상태는 실시간 상담 수신(crm.staff_settings)으로 바꿨다. */}
              <table>
                <thead><tr><th>이름</th><th>역할</th><th>연락처</th><th>담당 고객</th><th>접근 범위</th><th>상담 수신</th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={6}>구성원 불러오는 중…</td></tr>}
                  {failed && <tr><td colSpan={6}>구성원을 불러오지 못했습니다. (대표 전용 화면입니다)</td></tr>}
                  {!loading && !failed && members.length === 0 && <tr><td colSpan={6}>구성원이 없습니다.</td></tr>}
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td><strong>{m.name}</strong></td>
                      <td>{roleLabelOf(m.role)}</td>
                      {/* 표기는 화면 공통 SSOT(formatPhone) — 고객 목록·상세와 같은 하이픈 포맷.
                          앱 계정에 번호가 없는 구성원이 실제로 있다(실측 6명 중 2명). */}
                      <td>{m.phone ? formatPhone(m.phone) : "미입력"}</td>
                      <td>{m.assignedCustomers}명</td>
                      <td>{ROLE_ACCESS_SUMMARY[m.role] ?? "—"}</td>
                      <td>
                        {/* 딜러는 담당 고객·실시간 상담 개념이 없다(배정 후보에서도 제외) — 값 자체가 무의미. */}
                        {m.role === "dealer"
                          ? <span className="badge">해당 없음</span>
                          : <span className={m.liveReceiving ? "badge green" : "badge yellow"}>{m.liveReceiving ? "On" : "Off"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "teams" && (
            <div className="ops-card-grid">
              {teams.map(([name, mission, count]) => (
                <article className="ops-card" key={name}>
                  <span>{count}</span>
                  <strong>{name}</strong>
                  <p>{mission}</p>
                </article>
              ))}
            </div>
          )}

          {tab === "roles" && (
            <div className="ops-permission-list">
              {permissions.map(([role, scope]) => (
                <div className="ops-permission-row" key={role}>
                  <strong>{role}</strong>
                  <span>{scope}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="ops-side">
        <section className="card">
          <div className="panel-head"><h2>배정 원칙</h2><span className="badge">초안</span></div>
          <div className="panel-body brief-list">
            <div className="brief"><strong>상담 품질 우선</strong><span>단순 순번보다 고객 상황과 상담사 전문도를 기준으로 배정합니다.</span></div>
            <div className="brief"><strong>권한 최소화</strong><span>재무, 조직, AI 기준은 필요한 사람에게만 제한적으로 엽니다.</span></div>
            <div className="brief"><strong>기록 중심</strong><span>고객 이관, 견적 수정, 계약 변경은 변경 이력을 남기는 구조로 갑니다.</span></div>
          </div>
        </section>
      </aside>
    </div>
  );
}
