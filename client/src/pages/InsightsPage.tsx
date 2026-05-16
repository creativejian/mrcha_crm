const insights = [
  { title: "같은 차인데 가격이 다른 이유", category: "구매 가이드", status: "노출중", placement: "견적 분석 · 리스 금리", updatedAt: "오늘 10:20" },
  { title: "딜러 vs 에이전시, 어떤 선택이 좋을까", category: "구매 가이드", status: "노출중", placement: "첫 상담 · 구매 방식", updatedAt: "어제 18:42" },
  { title: "리스할 때 보증금과 선수금 차이", category: "금융 구조", status: "검수중", placement: "견적 분석 · 초기비용", updatedAt: "5/14 15:05" },
  { title: "중개 플랫폼 이용, 문제 없을까", category: "시장 이해", status: "초안", placement: "신뢰 형성 · 비교 견적", updatedAt: "5/13 11:30" },
];

function statusClass(status: string) {
  if (status === "노출중") return "badge green";
  if (status === "검수중") return "badge yellow";
  return "badge";
}

export function InsightsPage() {
  return (
    <section className="card">
      <div className="list-headbar">
        <div className="list-head-left">
          <div className="total-count">INSIGHTS <strong className="num">{insights.length}</strong></div>
          <div className="vertical-separator" />
          <div className="list-view-controls">
            <select className="select view-select"><option>노출 위치별 보기</option></select>
            <select className="select view-select"><option>카테고리별 보기</option></select>
          </div>
        </div>
        <div className="top-actions"><button className="btn primary" type="button">인사이트 등록</button></div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>제목</th><th>카테고리</th><th>상태</th><th>앱 노출 위치</th><th>수정일</th><th>관리</th></tr></thead>
          <tbody>
            {insights.map((item) => (
              <tr key={item.title}>
                <td><strong>{item.title}</strong><span className="table-note">차선생 상담 중 관련 인사이트로 연결</span></td>
                <td>{item.category}</td>
                <td><span className={statusClass(item.status)}>{item.status}</span></td>
                <td>{item.placement}</td>
                <td className="num">{item.updatedAt}</td>
                <td><button className="tiny-btn" type="button">편</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
