export function DeliveryPage() {
  return (
    <div className="grid dashboard-layout">
      <section className="card">
        <div className="panel-head"><h2>계약 / 출고 보드</h2><span className="badge green">진행중 12건</span></div>
        <div className="panel-body table-scroll">
          <table><thead><tr><th>고객</th><th>차량</th><th>금융사</th><th>계약일</th><th>출고 예정</th><th>상태</th><th>메모</th></tr></thead><tbody>
            <tr><td>최유진</td><td>테슬라 Model Y</td><td>B캐피탈</td><td>5/10</td><td>5/24</td><td><span className="badge yellow">탁송 조율</span></td><td>썬팅 예약 필요</td></tr>
            <tr><td>한지훈</td><td>GV80</td><td>현대캐피탈</td><td>5/08</td><td>5/29</td><td><span className="badge blue">출고 준비</span></td><td>보험 담보 확인</td></tr>
            <tr><td>오세린</td><td>MINI Cooper</td><td>A캐피탈</td><td>5/04</td><td>5/18</td><td><span className="badge green">배정 완료</span></td><td>PPF 일정 확정</td></tr>
          </tbody></table>
        </div>
      </section>
      <section className="card">
        <div className="panel-head"><h2>출고 체크리스트</h2><span className="badge">실무용</span></div>
        <div className="panel-body brief-list">
          {["계약서 서명 확인", "금융 승인 조건 확인", "보험 담보 조건 확인", "썬팅 / PPF / 블랙박스 일정", "탁송 시간 고객 안내", "출고 후 만족도 연락"].map((item, index) => <label className="mini-card" key={item}><input defaultChecked={index < 2} type="checkbox" /> {item}</label>)}
        </div>
      </section>
    </div>
  );
}
