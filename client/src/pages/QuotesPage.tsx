import { quotes } from "@/data/prototype";

type QuotesPageProps = { onToast: (message: string) => void };

const numericQuoteFields = new Set(["계약기간", "연간 주행거리", "보증금", "선수금", "잔존가치", "월 납입금", "만기 인수금"]);

export function QuotesPage({ onToast }: QuotesPageProps) {
  return (
    <div className="grid quote-layout">
      <section className="card">
        <div className="panel-head"><h2>견적 등록</h2><span className="badge">수동 입력 MVP</span></div>
        <div className="panel-body">
          <div className="form-grid">
            {[['고객', '김민준'], ['차량', 'BMW X3 20i'], ['트림 / 컬러', 'M Sport / 블랙'], ['금융사', 'A캐피탈'], ['계약기간', '48개월'], ['연간 주행거리', '20,000km'], ['보증금', '20%'], ['선수금', '0원'], ['잔존가치', '52%'], ['월 납입금', '842,000원'], ['만기 인수금', '38,480,000원'], ['출고 가능', '가능']].map(([label, value]) => <div className="form-field" key={label}><label>{label}</label><input className={`input ${numericQuoteFields.has(label) ? "num" : ""}`} defaultValue={value} /></div>)}
          </div>
          <div className="form-field block-field"><label>견적 메모</label><textarea className="textarea" defaultValue="월 납입금은 중간 수준이나 잔존가치가 높아 만기 인수 판단 필요. 중도해지 조건 설명 권장." /></div>
          <div className="button-row"><button className="btn primary" onClick={() => onToast("견적이 구조화 데이터로 저장되었습니다.")} type="button">견적 저장</button><button className="btn" type="button">PDF 첨부</button></div>
        </div>
      </section>
      <section className="card">
        <div className="panel-head"><h2>동일 고객 견적 비교</h2><span className="badge blue">김민준 고객</span></div>
        <div className="panel-body table-scroll">
          <table className="comparison"><thead><tr><th>선택</th><th>차량</th><th>금융사</th><th>기간</th><th>초기비용</th><th>잔존</th><th>월납입</th><th>출고</th><th>판단</th></tr></thead><tbody>{quotes.map((quote, index) => <tr key={`${quote.finance}-${quote.vehicle}`}><td><input defaultChecked={index === 0} name="quote" type="radio" /></td><td>{quote.vehicle}</td><td>{quote.finance}</td><td className="num">{quote.period}</td><td className="num">{quote.initial}</td><td className="num">{quote.residual}</td><td><strong className="num">{quote.monthly}</strong></td><td>{quote.stock}</td><td><span className={quote.verdict === "추천" ? "badge green" : quote.verdict.includes("변수") ? "badge yellow" : "badge blue"}>{quote.verdict}</span></td></tr>)}</tbody></table>
          <div className="send-box"><strong>앱 송출 프리뷰</strong><span>고객 앱에는 “추천 견적 1개 + 비교 견적 2개 + 차선생 해석” 형태로 보여주는 방향을 제안합니다.</span><button className="btn primary" onClick={() => onToast("선택 견적이 고객 앱으로 송출된 것으로 표시합니다.")} type="button">선택 견적 앱으로 송출</button></div>
        </div>
      </section>
    </div>
  );
}
