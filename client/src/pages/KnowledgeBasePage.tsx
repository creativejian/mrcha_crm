const knowledgeGroups = [
  {
    title: "에이전시",
    items: [
      "에이전시 구조 설명",
      "에이전시 견적 구조의 이해",
      "딜러 vs 에이전시 선택 기준",
      "중개플랫폼 이용 시 리스크 & 소비자 체크리스트",
    ],
  },
  {
    title: "할인 프로모션",
    items: ["할인 구조의 원리", "할인 타이밍과 변동 구조", "할인 종류와 적용 구조", "담당자 재량과 조정 구조", "할인 판단 & 견적 검증 기준"],
  },
  {
    title: "리스의 구조 이해",
    items: ["리스의 구조와 종류", "운용리스의 구조", "금융리스의 구조", "이용자명의리스의 구조", "리스 3대 구조 종합 정리"],
  },
];

export function KnowledgeBasePage() {
  const total = knowledgeGroups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section className="card">
      <div className="list-headbar">
        <div className="list-head-left">
          <div className="total-count">KNOWLEDGE <strong className="num">{total}</strong></div>
          <div className="vertical-separator" />
          <div className="list-view-controls">
            <select className="select view-select"><option>카테고리별 보기</option></select>
            <select className="select view-select"><option>검수 상태별 보기</option></select>
          </div>
        </div>
        <div className="top-actions"><button className="btn primary" type="button">지식 등록</button></div>
      </div>
      <div className="knowledge-list">
        {knowledgeGroups.map((group, index) => (
          <section className="knowledge-group" key={group.title}>
            <h2><span className="num">{index + 1}.</span> {group.title} <span className="num">({group.items.length})</span></h2>
            <div className="knowledge-items">
              {group.items.map((item, itemIndex) => (
                <button className="knowledge-row" key={item} type="button">
                  <span>{group.title} - <span className="num">{itemIndex + 1}.</span> {item}</span>
                  <small className="num">26.03.24</small>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
