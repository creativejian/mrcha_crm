const dataScopes = [
  ["브랜드", "국산차 / 수입차 제조사와 앱 노출 순서"],
  ["모델", "시리즈, 차급, 판매 상태, 대표 이미지"],
  ["트림", "MC코드, 연식, 기본가격, 색상, 할인 기준"],
  ["연동", "Supabase 차량 마스터 테이블 연결 예정"],
];

export function MCMasterPage() {
  return (
    <section className="card">
      <div className="panel-head">
        <h2>차선생 차량 데이터 기준</h2>
        <span className="badge blue">연동 예정</span>
      </div>
      <div className="panel-body">
        <div className="notice-box">
          <strong>MC코드 기반 차량 마스터 관리 메뉴입니다.</strong>
          <span>브랜드, 모델, 트림 단위 데이터는 추후 Supabase와 연결해서 선생님 개발 환경 기준에 맞춰 붙입니다.</span>
        </div>
        <div className="mini-grid">
          {dataScopes.map(([title, desc]) => (
            <article className="mini-card" key={title}>
              <strong>{title}</strong>
              <span>{desc}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
