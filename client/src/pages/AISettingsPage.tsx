const guardrails = [
  ["영업 우선 금지", "신뢰가 형성되기 전에는 견적 유도보다 구조 설명을 먼저 합니다."],
  ["모르는 내용 인정", "금융사 정책, 재고, 실제 승인 여부는 단정하지 않고 확인 필요로 답합니다."],
  ["중립 비교", "특정 판매사나 금융사를 밀지 않고 고객 상황 기준으로 장단점을 설명합니다."],
];

export function AISettingsPage() {
  return (
    <div className="ai-settings-layout">
      <section className="card ai-settings-main">
        <div className="panel-head"><h2>차선생 응답 기준</h2><span className="badge green">운영중</span></div>
        <div className="panel-body ai-settings-stack">
          <div className="setting-block">
            <div className="setting-block-head"><h3>AI 페르소나</h3><span className="badge">기본 프롬프트</span></div>
            <textarea
              className="textarea ai-textarea"
              defaultValue={`차선생은 고객 편에 서서 자동차 구매 구조를 설명하는 상담 전문가입니다.
친절하지만 가볍지 않게 말하고, 고객을 '고객님'으로 호칭합니다.
리스, 렌트, 할부, 견적 구조를 쉽게 풀어 설명합니다.
확실하지 않은 재고, 승인, 조건은 단정하지 않고 확인이 필요하다고 안내합니다.`}
            />
            <div className="char-count"><span className="num">214</span>/<span className="num">2000</span></div>
          </div>

          <div className="setting-block">
            <div className="setting-block-head"><h3>답변 성향</h3><span className="badge blue">상담 품질</span></div>
            <div className="ai-control-grid">
              <label className="ai-control">
                <span>창의성</span>
                <strong className="num">0.7</strong>
                <input defaultValue="0.7" max="1" min="0" step="0.1" type="range" />
                <small>낮을수록 일관된 답변, 높을수록 다양한 설명</small>
              </label>
              <label className="ai-control">
                <span>상담 전환 적극도</span>
                <strong className="num">0.4</strong>
                <input defaultValue="0.4" max="1" min="0" step="0.1" type="range" />
                <small>상담 연결은 신뢰가 생긴 뒤 자연스럽게 제안</small>
              </label>
            </div>
          </div>

          <div className="setting-block">
            <div className="setting-block-head"><h3>추가 지시사항</h3><span className="badge yellow">운영 메모</span></div>
            <textarea
              className="textarea ai-textarea short"
              defaultValue={`할인 관련 질문은 조건 확인 전 확정적으로 답하지 않습니다.
경쟁사 비교는 감정적으로 비판하지 않고 구조 차이만 설명합니다.
견적을 받은 고객에게는 월 납입금, 총 비용, 잔존가치, 중도해지 조건 순서로 안내합니다.`}
            />
            <div className="char-count"><span className="num">123</span>/<span className="num">2000</span></div>
          </div>
        </div>
      </section>

      <aside className="ai-settings-side">
        <section className="card">
          <div className="panel-head"><h2>상담 가드레일</h2><span className="badge">필수</span></div>
          <div className="panel-body brief-list">
            {guardrails.map(([title, desc]) => <div className="brief" key={title}><strong>{title}</strong><span>{desc}</span></div>)}
          </div>
        </section>
        <section className="card">
          <div className="panel-head"><h2>저장 전 확인</h2><span className="badge blue">체크</span></div>
          <div className="panel-body action-stack">
            <label className="mini-card"><input defaultChecked type="checkbox" /> 지식베이스 우선 참조</label>
            <label className="mini-card"><input defaultChecked type="checkbox" /> 금융 조건 단정 금지</label>
            <label className="mini-card"><input defaultChecked type="checkbox" /> 실제 상담 연결 문구 완곡화</label>
            <button className="btn primary" type="button">AI 설정 저장</button>
          </div>
        </section>
      </aside>
    </div>
  );
}
