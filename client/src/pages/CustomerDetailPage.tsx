import { quotes, timeline } from "@/data/prototype";

type CustomerDetailPageProps = { onToast: (message: string) => void };

export function CustomerDetailPage({ onToast }: CustomerDetailPageProps) {
  return (
    <div className="split">
      <section className="card">
        <div className="profile-head">
          <div className="profile-name"><div className="avatar">김</div><div><h2>김민준 고객</h2><p>BMW X3 / GLC 비교 · 유튜브 유입 · 견적발송 상태</p></div></div>
          <span className="badge yellow">견적발송</span>
        </div>
        <div className="panel-body grid">
          <div className="detail-grid">
            <div className="field-card"><span>연락처</span><strong className="num">010-4382-2190</strong></div>
            <div className="field-card"><span>지역</span><strong>경기 성남</strong></div>
            <div className="field-card"><span>담당자</span><strong>지안</strong></div>
            <div className="field-card"><span>출고 희망</span><strong>6월 초</strong></div>
          </div>
          <div>
            <h3 className="section-title">AI 상담 요약</h3>
            <div className="ai-summary">
              {[['관심 차량', 'BMW X3, 벤츠 GLC'], ['구매 방식', '운용리스 우선 검토'], ['예산', '월 90만원 이하'], ['핵심 포인트', '중도해지 리스크, 총 비용'], ['초기비용 성향', '보증금 낮게, 선수금 없음'], ['브랜드 성향', '독일 SUV 선호, 패밀리 용도']].map(([label, value]) => <div className="field-card" key={label}><span>{label}</span><strong className={label === "예산" ? "num" : ""}>{value}</strong></div>)}
            </div>
          </div>
          <div>
            <h3 className="section-title">상담 메모</h3>
            <textarea className="textarea" defaultValue="경쟁사에서 X3 견적 2장 받은 상태. 월 납입금보다 총 비용과 중도해지 조건을 더 민감하게 봄. GLC는 재고 확인 필요." />
          </div>
          <div>
            <h3 className="section-title">상담 타임라인</h3>
            <div className="timeline">{timeline.map(([type, title, desc]) => <div className="timeline-item" data-type={type} key={title}><strong>{title}</strong><span>{desc}</span></div>)}</div>
          </div>
        </div>
      </section>
      <aside className="grid">
        <section className="card"><div className="panel-head"><h2>다음 액션</h2><span className="badge red">오늘 처리</span></div><div className="panel-body brief-list"><div className="brief"><strong>GLC 재고 조건 확인</strong><span>재고가 없으면 X3 조건으로 빠르게 좁히는 편이 좋습니다.</span></div><div className="brief"><strong>중도해지 조건 설명 필요</strong><span>월납입금보다 리스크 회피 성향이 강합니다.</span></div><button className="btn primary" onClick={() => onToast("견적 송출 프로토타입: 고객 앱에 비교 견적이 전달된 것으로 표시합니다.")} type="button">앱으로 비교 견적 송출</button></div></section>
        <section className="card"><div className="panel-head"><h2>견적 요약</h2><span className="badge blue"><span className="num">3</span>개 비교</span></div><div className="panel-body quote-list">{quotes.map((quote) => <div className="quote-card" key={`${quote.finance}-${quote.vehicle}`}><strong>{quote.vehicle}</strong><span>{quote.finance} · <span className="num">{quote.period}</span> · 월 <span className="num">{quote.monthly}</span></span><span className={quote.verdict === "추천" ? "badge green" : quote.verdict.includes("변수") ? "badge yellow" : "badge blue"}>{quote.verdict}</span></div>)}</div></section>
      </aside>
    </div>
  );
}
