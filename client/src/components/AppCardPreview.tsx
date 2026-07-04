import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { AppCardModel } from "@/lib/app-card";

// 고객 앱 견적카드 미리보기(4섹션 상세 카드, 2026-07-04 이사님 확정 디자인 미러 — 디자인 4장 대조 반영).
// model 1개만 받고 DOM/state를 직접 읽지 않는다(조립은 부모 워크벤치 책임).
// 바깥 .kim-app-card-preview는 워크벤치 grid 배치가 참조하므로 유지, 내부는 app-card-* 신규 문법.
export function AppCardPreview({ model, inModal = false }: { model: AppCardModel; inModal?: boolean }) {
  // 앱 동작 미러: 취득원가/추천조건 아코디언은 접힌 채 시작, "상세 견적"이 일괄 펼침 토글.
  const [costOpen, setCostOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const detailOpen = costOpen && conditionOpen;
  function toggleDetail() {
    const next = !detailOpen;
    setCostOpen(next);
    setConditionOpen(next);
  }
  return (
    <aside className={`kim-app-card-preview${inModal ? " in-modal" : ""}`} aria-label="앱 견적카드 미리보기">
      <div className="app-card">
        {/* 섹션 1 — 헤더·핵심 요약(녹색 헤더 바 + 흰 본문) */}
        <section className="app-card-hero">
          <div className="app-card-hero-head">
            <span>🔔 {model.statusLabel}</span>
            <em>● {model.ddayLabel}</em>
          </div>
          <div className="app-card-hero-body">
            <div className="app-card-title-row">
              <span className="app-card-brand">{model.brand}</span>
              <div className="app-card-chip-row">
                <span>{model.purchaseMethod}</span>
                <span>{model.termLabel}</span>
              </div>
            </div>
            <strong className="app-card-model">{model.vehicleTitle}</strong>
            <p className="app-card-subline">{model.sublineLabel}</p>
            <div className="app-card-pay">
              <span>월 납입금</span>
              <div>
                <strong>{model.monthlyLabel}</strong>
                {model.rateChipLabel ? <em>{model.rateChipLabel}</em> : null}
              </div>
              <p>잔존가치 {model.residualLabel} ㅣ 총 비용 {model.totalCostLabel}</p>
            </div>
            <div className="app-card-discount-row">
              <span>{model.discountRowLabel}</span>
              <strong>-{model.discountLabel}원</strong>
            </div>
            <div className="app-card-mini-grid">
              <div><span>보증금</span><strong>{model.depositLabel}</strong></div>
              <div><span>주행거리</span><strong>{model.mileageLabel}</strong></div>
            </div>
            {model.keyPoints.length ? (
              <div className="app-card-keypoints">
                <header>📊 견적 핵심 포인트</header>
                <ul>{model.keyPoints.map((point, i) => <li key={`${i}-${point}`}>{point}</li>)}</ul>
              </div>
            ) : null}
            <div className="app-card-cta-row">
              <button className="app-card-consult" disabled type="button">이 견적으로 상담 시작하기</button>
              <button aria-expanded={detailOpen} className="app-card-detail-pill" onClick={toggleDetail} type="button">● 상세 견적</button>
            </div>
          </div>
        </section>

        {/* 섹션 2 — 출고 정보 + 취득원가 구성 */}
        <section className="app-card-block">
          <header className="app-card-block-head is-blue">🚗 &ldquo;{model.deliveryComment}&rdquo;</header>
          <dl className="app-card-rows">
            <dt>외장 컬러</dt><dd>{model.exteriorColorLabel}</dd>
            <dt>내장 컬러</dt><dd>{model.interiorColorLabel}</dd>
            <dt>추가 옵션</dt><dd>{model.optionSummaryLabel}</dd>
            <dt>재고 여부</dt><dd className="is-green">{model.stockNotice}</dd>
            <dt>예상 출고 기간</dt><dd className="is-green">{model.expectedDelivery}</dd>
            <dt>고객 지역</dt><dd>{model.customerRegion}</dd>
          </dl>
        </section>
        <section className="app-card-block">
          <button aria-expanded={costOpen} className="app-card-block-head is-blue is-toggle" onClick={() => setCostOpen((open) => !open)} type="button">
            📌 &ldquo;취득원가 구성을 확인하는 것이 중요해요&rdquo;
            {costOpen ? <ChevronUp size={15} strokeWidth={2.4} /> : <ChevronDown size={15} strokeWidth={2.4} />}
          </button>
          {costOpen ? (
            <dl className="app-card-rows">
              <dt>차량 기본가격</dt><dd>{model.basePriceLabel}원</dd>
              <dt>추가 옵션가격</dt><dd>{model.optionTotalLabel}원</dd>
              <dt>할인금액</dt><dd>-{model.discountLabel}원</dd>
              <dt className="is-strong">최종 차량가격 ①</dt><dd className="is-green is-strong">{model.finalVehiclePriceLabel}원</dd>
              <dt>취득세 ({model.acquisitionTaxModeLabel})</dt><dd>{model.acquisitionTaxLabel}원</dd>
              <dt>공채</dt><dd>{model.bondLabel}원</dd>
              <dt>탁송료</dt><dd>{model.deliveryFeeLabel}원</dd>
              <dt>부대비용</dt><dd>{model.incidentalLabel}원</dd>
              <dt className="is-strong">등록비용 합계 ②</dt><dd className="is-green is-strong">{model.registrationCostLabel}원</dd>
              <dt className="is-strong">취득원가 ① + ②</dt><dd className="is-blue is-strong">{model.acquisitionCostLabel}원</dd>
            </dl>
          ) : null}
        </section>

        {/* 섹션 3 — 추천 견적 조건(대표 시나리오 전체) */}
        <section className="app-card-block">
          <button aria-expanded={conditionOpen} className="app-card-block-head is-blue is-toggle" onClick={() => setConditionOpen((open) => !open)} type="button">
            📄 &ldquo;가장 추천드리는 견적 조건입니다!&rdquo;
            {conditionOpen ? <ChevronUp size={15} strokeWidth={2.4} /> : <ChevronDown size={15} strokeWidth={2.4} />}
          </button>
          {conditionOpen ? (
            model.hasScenario ? (
              <dl className="app-card-rows">
                <dt>구매방식</dt><dd>{model.purchaseMethod}</dd>
                <dt>금융사</dt><dd>{model.lenderLabel}</dd>
                <dt>리스기간</dt><dd>{model.termLabel}</dd>
                <dt>약정주행거리</dt><dd>{model.mileageLabel}</dd>
                <dt>보증금</dt><dd>{model.depositLabel}</dd>
                <dt>{model.downPaymentRowLabel}</dt><dd>{model.downPaymentLabel}</dd>
                <dt>잔존가치</dt><dd>{model.residualCondLabel}</dd>
                <dt>자동차세</dt><dd>{model.carTaxLabel}</dd>
                <dt>전기차 보조금</dt><dd>{model.subsidyLabel}</dd>
                <dt>금리 (잔존가치 지불 시)</dt><dd className="is-green">{model.rateLabel}</dd>
                <dt>반납까지 총 비용</dt><dd>{model.totalReturnCostLabel}</dd>
                <dt>인수까지 총 비용 (인수 시 취득세 별도)</dt><dd>{model.totalTakeoverCostLabel}</dd>
                <dt className="is-strong">최종 월 납입금</dt><dd className="is-blue is-big">{model.monthlyLabel}</dd>
                <dt className="is-strong">출고 전 납입금액</dt><dd className="is-blue is-big">{model.dueAtDeliveryLabel}</dd>
              </dl>
            ) : (
              <p className="app-card-empty">조건 저장 후 표시됩니다</p>
            )
          ) : null}
        </section>

        {/* 섹션 4 — 추천 이유 + 서비스 + 푸터 */}
        {model.recommendReasons.length ? (
          <section className="app-card-block">
            <header className="app-card-block-head is-blue">💡 &ldquo;이 견적을 추천드리는 이유는요&rdquo;</header>
            <ul className="app-card-reasons">
              {model.recommendReasons.map((reason, i) => <li key={`${i}-${reason}`}>{reason}</li>)}
            </ul>
          </section>
        ) : null}
        {model.services.length ? (
          <section className="app-card-block">
            <header className="app-card-block-head is-orange">🎁 &ldquo;서비스가 빠질수가 있나요&rdquo;</header>
            <ul className="app-card-services">
              {model.services.map((service, i) => (
                <li key={`${i}-${service.value}`}>
                  {service.label ? <span className="app-card-service-label">{service.label}</span> : null}
                  <b>{service.value}</b>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <footer className="app-card-foot">
          <span>{model.footerStampLabel}</span>
          <span>No. {model.quoteCodeLabel}</span>
        </footer>
      </div>
    </aside>
  );
}
