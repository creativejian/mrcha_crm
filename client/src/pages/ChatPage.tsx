type ChatPageProps = { onNavigate: (view: string) => void; onToast: (message: string) => void };

export function ChatPage({ onNavigate, onToast }: ChatPageProps) {
  const requests = [
    ["김민준", "긴급", "red", "BMW X3와 GLC 견적 비교 중. 타사 견적 2장 보유, 중도해지 조건 질문.", "앱 상담원 연결", "12분 대기"],
    ["박서연", "높음", "yellow", "Model Y 장기렌트 문의. 초기비용 0원 조건과 보험 포함 여부 확인 희망.", "AI 상담중", "5분 전"],
    ["이도윤", "보통", "", "GV80 개인사업자 리스 심사 가능성 문의. 필요 서류 안내 요청.", "상담사 배정", "선생님"],
    ["한지훈", "계약 후보", "green", "GV80 출고 일정 확인. 계약 조건 재확인 후 진행 의사 있음.", "응답 대기", "오늘 14:05"],
  ];

  return (
    <>
      <div className="chat-tabs">
        {["전체 12", "상담원 연결 요청 4", "AI 상담중 5", "응답 대기 3", "종료 18"].map((tab, index) => <button className={`chat-tab ${index === 0 ? "active" : ""}`} key={tab} type="button">{tab}</button>)}
      </div>
      <div className="chat-layout">
        <section className="card chat-panel">
          <div className="panel-head"><h2>상담 연결 큐</h2><span className="badge red">미배정 4</span></div>
          <div className="chat-queue">
            {requests.map(([name, level, color, desc, state, time], index) => (
              <button className={`chat-request ${index === 0 ? "active" : ""}`} key={name} type="button">
                <div className="chat-request-head"><strong>{name}</strong><span className={`badge ${color}`}>{level}</span></div>
                <p>{desc}</p>
                <div className="chat-meta"><span className="badge">{state}</span><span className={time === "선생님" ? "badge green" : "badge yellow"}>{time}</span></div>
              </button>
            ))}
          </div>
        </section>

        <section className="card chat-window">
          <div className="chat-header">
            <div><h2>김민준 · 상담원 연결 요청</h2><span>앱 AI 상담에서 실제 상담사 연결을 요청했습니다. 마지막 업데이트 12분 전</span></div>
            <div className="top-actions"><button className="btn" onClick={() => onToast("상담사가 배정되었습니다.")} type="button">지안에게 배정</button><button className="btn primary" onClick={() => onToast("앱 고객과 실시간 상담을 시작합니다.")} type="button">채팅 시작</button></div>
          </div>
          <div className="chat-messages">
            <div className="message ai">AI 상담 요약: 고객은 BMW X3와 GLC를 비교 중이며, 월 납입금보다 중도해지 리스크와 총 비용을 더 중요하게 보고 있습니다. 이미 타사 견적 2개를 받은 상태입니다.</div>
            <div className="message customer">X3랑 GLC 중에 리스로 보면 뭐가 더 괜찮을까요? 월 납입금만 보면 X3가 좋아 보이긴 하는데 중도해지가 걱정돼요.<small>고객 · 14:12</small></div>
            <div className="message customer">상담원 연결해서 받은 견적이 괜찮은 건지 한번 보고 싶어요.<small>고객 · 14:14</small></div>
            <div className="message advisor">안녕하세요, 차선생 상담사 지안입니다. 견적은 월 납입금만 보면 판단이 어려워서 총 비용, 잔존가치, 중도해지 조건까지 같이 비교해드릴게요.<small>상담사 프리뷰</small></div>
          </div>
          <div className="chat-compose"><input className="input" defaultValue="견적서 사진이나 조건을 보내주시면 구조부터 먼저 봐드릴게요." /><button className="btn" onClick={() => onToast("AI 상담 요약을 최신 내용으로 불러왔습니다.")} type="button">AI 요약 불러오기</button><button className="btn primary" onClick={() => onToast("상담 메시지가 앱 채팅방으로 전송되었습니다.")} type="button">전송</button></div>
        </section>

        <aside className="card chat-panel">
          <div className="panel-head"><h2>고객 전환 패널</h2><span className="badge blue">AI 기반</span></div>
          <div className="panel-body">
            <div className="insight-stack">
              {[
                ["고객 의도", "견적 검토와 차종 비교", "구매 결정보다 조건 신뢰도 확인이 먼저 필요한 상태입니다."],
                ["관심 차량", "BMW X3 / Mercedes-Benz GLC", "SUV, 가족 사용, 월 90만원 이하 희망."],
                ["구매 방식", "운용리스 검토", "잔존가치, 중도해지, 총 비용 설명 필요."],
                ["상담 리스크", "타사 견적 기준으로 비교 중", "무리한 영업보다 구조 설명 후 차선생 비교표로 신뢰를 만드는 흐름이 적합합니다."],
              ].map(([label, value, desc]) => <div className="insight-item" key={label}><span>{label}</span><strong>{value}</strong><p>{desc}</p></div>)}
            </div>
            <div className="action-stack"><button className="btn primary" onClick={() => onNavigate("customer-detail")} type="button">고객 상세 생성 / 이동</button><button className="btn" onClick={() => onNavigate("quotes")} type="button">견적 작성으로 이동</button><button className="btn" onClick={() => onToast("상담사 배정 변경 자리입니다.")} type="button">상담사 배정 변경</button><button className="btn" onClick={() => onToast("상담 종료 처리와 후속 액션 저장 자리입니다.")} type="button">상담 종료 처리</button></div>
          </div>
        </aside>
      </div>
    </>
  );
}
