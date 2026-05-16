import { useState } from "react";

const members = [
  ["김지안", "대표 / 최고관리자", "전체", "전체 권한", "운영중"],
  ["선생님", "CTO / AI 총괄", "기술본부", "AI, 데이터, 개발환경", "운영중"],
  ["제프", "견적 솔루션 개발", "기술본부", "견적, 금융 로직", "운영중"],
  ["상담사 A", "상담사", "상담팀", "상담, 고객 관리", "초대 예정"],
];

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
              <table>
                <thead><tr><th>이름</th><th>역할</th><th>소속</th><th>접근 범위</th><th>상태</th></tr></thead>
                <tbody>
                  {members.map(([name, role, team, scope, status]) => (
                    <tr key={name}>
                      <td><strong>{name}</strong></td>
                      <td>{role}</td>
                      <td>{team}</td>
                      <td>{scope}</td>
                      <td><span className={status === "운영중" ? "badge green" : "badge yellow"}>{status}</span></td>
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
