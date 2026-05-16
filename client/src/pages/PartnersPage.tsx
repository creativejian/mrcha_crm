import { useState } from "react";

const tabs = ["딜러", "금융사", "시공 / 탁송", "제휴처", "거래 조건", "평가 / 메모"] as const;
type PartnerTab = typeof tabs[number];

const partnerRows: Record<PartnerTab, Array<[string, string, string, string, string]>> = {
  딜러: [
    ["BMW 인천 딜러", "수입차 / BMW", "김담당", "빠른 재고 확인", "우수"],
    ["벤츠 송도 딜러", "수입차 / Mercedes-Benz", "박담당", "견적 회신 보통", "관리"],
    ["현대 법인팀", "국산차 / 현대", "이담당", "법인 출고 강점", "우수"],
  ],
  금융사: [
    ["BNK캐피탈", "운용리스", "최담당", "프로모션 변동 빠름", "우수"],
    ["메리츠캐피탈", "리스 / 렌트", "정담당", "승인 조건 안정적", "우수"],
    ["iM캐피탈", "리스", "한담당", "수입차 조건 확인 필요", "관리"],
  ],
  "시공 / 탁송": [
    ["프리미엄 틴팅샵", "썬팅 / 블랙박스", "오대표", "고객 만족도 높음", "우수"],
    ["인천 탁송 라인", "탁송", "배차팀", "주말 배차 확인 필요", "관리"],
    ["PPF 전문점", "PPF / 코팅", "문실장", "고가 차량 대응 가능", "우수"],
  ],
  제휴처: [
    ["보험 파트너", "자동차 보험", "강담당", "출고 전 담보 확인", "우수"],
    ["세무 파트너", "사업자 상담", "윤세무사", "법인/개인사업자 대응", "검토"],
    ["콘텐츠 파트너", "유튜브 / 숏폼", "제작팀", "광고 소재 협의", "검토"],
  ],
  "거래 조건": [
    ["수수료 기준", "금융사", "정산팀", "계약/출고/입금 기준 분리", "정책화"],
    ["출고 비용", "시공 / 탁송", "출고팀", "건별 비용 증빙 필수", "운영중"],
    ["할인 공유", "딜러", "견적팀", "할인 변경일과 유효기간 기록", "운영중"],
  ],
  "평가 / 메모": [
    ["응답 속도", "전체 거래처", "운영팀", "견적 회신 30분 이내 우선", "평가중"],
    ["조건 신뢰도", "딜러 / 금융사", "대표실", "제시 조건과 실제 계약 차이 추적", "중요"],
    ["고객 경험", "시공 / 탁송", "출고팀", "출고 후 불만/칭찬 메모 누적", "평가중"],
  ],
};

const partnerStats = [
  ["등록 거래처", "24", "운영중 18곳"],
  ["우수 파트너", "9", "우선 연결 후보"],
  ["확인 필요", "5", "조건/응대 재점검"],
  ["이번 달 거래", "17", "출고/견적 연결"],
];

export function PartnersPage() {
  const [activeTab, setActiveTab] = useState<PartnerTab>("딜러");
  const rows = partnerRows[activeTab];

  return (
    <>
      <div className="grid finance-stats">
        {partnerStats.map(([label, value, note]) => (
          <div className="card stat" key={label}>
            <span>{label}</span>
            <strong className="num">{value}</strong>
            <em>{note}</em>
          </div>
        ))}
      </div>

      <div className="partner-layout">
        <section className="card">
          <div className="panel-head"><h2>외부 협력 네트워크</h2><span className="badge blue">{activeTab}</span></div>
          <div className="panel-body">
            <div className="partner-tabs">
              {tabs.map((tab) => <button className={activeTab === tab ? "active" : ""} key={tab} onClick={() => setActiveTab(tab)} type="button">{tab}</button>)}
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>이름</th><th>구분</th><th>담당</th><th>관리 메모</th><th>상태</th></tr></thead>
                <tbody>
                  {rows.map(([name, type, owner, memo, status]) => (
                    <tr key={`${activeTab}-${name}`}>
                      <td><strong>{name}</strong></td>
                      <td>{type}</td>
                      <td>{owner}</td>
                      <td>{memo}</td>
                      <td><span className={status === "우수" || status === "운영중" ? "badge green" : status === "중요" ? "badge red" : "badge yellow"}>{status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside className="ops-side">
          <section className="card">
            <div className="panel-head"><h2>관리 기준</h2><span className="badge">외부</span></div>
            <div className="panel-body brief-list">
              <div className="brief"><strong>조건 신뢰도</strong><span>제시 조건과 실제 계약 조건이 달라지는 파트너는 별도 관리합니다.</span></div>
              <div className="brief"><strong>응답 품질</strong><span>재고, 할인, 승인 가능성 회신 속도와 정확도를 기록합니다.</span></div>
              <div className="brief"><strong>고객 경험</strong><span>출고 과정에서 고객 불만이 생긴 거래처는 다음 배정에서 주의합니다.</span></div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
